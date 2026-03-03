import { google } from "@ai-sdk/google";
import {
  streamText,
  tool,
  stepCountIs,
  convertToModelMessages,
  UIMessage,
} from "ai";
import { z } from "zod";
import { pickRandomQuestion, topics } from "@/lib/quiz-data";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Extract already-shown question IDs from conversation history
  const shownIds: string[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.parts) {
        if (
          part.type === "tool-quizQuestion" &&
          "state" in part &&
          part.state === "output-available" &&
          "output" in part &&
          part.output &&
          typeof part.output === "object" &&
          "questionId" in part.output
        ) {
          shownIds.push((part.output as { questionId: string }).questionId);
        }
      }
    }
  }

  const result = streamText({
    model: google("gemini-3-flash-preview"),
    system: `You are a friendly, encouraging vibecoding quiz host. Your job is to quiz users on vibecoding concepts using interactive question cards.

When the user wants to take a quiz or asks about vibecoding:
1. Call the quizQuestion tool to show them a question card
2. The user will click their answer in the interactive card, and the result comes back to you
3. React briefly — celebrate correct answers, gently explain incorrect ones
4. Then call quizQuestion again for the next question
5. After 5-7 questions, summarize their results and offer to continue or switch topics

Keep responses SHORT (1-2 sentences). The quiz card handles the visual experience — you provide the conversational wrapper.

Available topics: ${topics.join(", ")}

When the user answers, the result comes as a message starting with [Quiz Answer]. Parse it to understand what they answered and whether they got it right.

Don't repeat the question or answer options in your response — the user already sees them in the card.`,
    messages: await convertToModelMessages(messages),
    tools: {
      quizQuestion: tool({
        description:
          "Show an interactive quiz question card. The user sees a visual card with 4 answer options and clicks their choice. Call this once per question.",
        inputSchema: z.object({
          topic: z
            .enum(topics)
            .optional()
            .describe("Quiz topic. Leave empty for random."),
        }),
        execute: async ({ topic }) => {
          const question = pickRandomQuestion(shownIds, topic);
          if (!question) {
            return {
              exhausted: true as const,
              message: `All questions have been shown${topic ? ` for "${topic}"` : ""}!`,
            };
          }
          shownIds.push(question.id);
          return {
            questionId: question.id,
            topic: question.topic,
            question: question.question,
            options: question.options,
            correctIndex: question.correctIndex,
            explanation: question.explanation,
          };
        },
      }),
    },
    stopWhen: stepCountIs(3),
  });

  return result.toUIMessageStreamResponse();
}
