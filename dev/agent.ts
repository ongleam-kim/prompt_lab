import { z } from "zod";
import { ChatTogetherLLM } from "../lib/llms";
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { PROMPT } from "./prompts";

const llm = ChatTogetherLLM;
const StateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  nextRepresentative: Annotation<string>,
  refundAuthorized: Annotation<boolean>,
});

const routingSchema = z.object({
  nextRepresentative: z.enum(["RESPOND", "CERTIFICATION"]),
});

const initialSupport = async (state: typeof StateAnnotation.State) => {
  const supportResponse = await llm.invoke([
    { role: "system", content: PROMPT.init.system },
    ...state.messages,
  ]);

  const structuredOutputModel = llm.withStructuredOutput(
    routingSchema,
    { name: "RouteUserRequest" } // Optional name for the underlying tool call
  );

  const routingMessages = [
    new SystemMessage(PROMPT.routing.system),
    ...state.messages,
    new HumanMessage(PROMPT.routing.user),
  ];

  const routingResponse = await structuredOutputModel.invoke(routingMessages);

  return {
    messages: [supportResponse],
    nextRepresentative: routingResponse.nextRepresentative,
  };
};

const certificationSupport = async (state: typeof StateAnnotation.State) => {
  let trimmedHistory = state.messages;
  // Make the user's question the most recent message in the history.
  // This helps small models stay focused.
  if (trimmedHistory.at(-1)._getType() === "ai") {
    trimmedHistory = trimmedHistory.slice(0, -1);
  }

  const response = await llm.invoke([
    new SystemMessage(PROMPT.certification.system),
    ...trimmedHistory,
  ]);

  return {
    messages: response,
  };
};

import { StateGraph } from "@langchain/langgraph";

let workflow = new StateGraph(StateAnnotation)
  .addNode("initial_support", initialSupport)
  .addNode("certification_support", certificationSupport)
  .addEdge("__start__", "initial_support");

workflow = workflow.addConditionalEdges(
  "initial_support",
  async (state: typeof StateAnnotation.State) => {
    if (state.nextRepresentative.includes("CERTIFICATION")) {
      return "certification";
    } else {
      return "conversational";
    }
  },
  {
    certification: "certification_support",
    conversational: "__end__",
  }
);

workflow = workflow.addEdge("certification_support", "__end__");

console.log("Added edges!");

import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const checkpointer = new MemorySaver();

const app = workflow.compile({
  checkpointer,
});

// --- Visualizing graph --- //
// import { writeFileSync } from "node:fs";
// const graph = await app.getGraphAsync();

// const mermaid = graph.drawMermaid();
// const image = await graph.drawMermaidPng();

// const arrayBuffer = await image.arrayBuffer();

// const filePath = "./dev/graph.png";
// writeFileSync(filePath, new Uint8Array(arrayBuffer));
// console.log(`그래프 상태가 ${filePath}에 저장되었습니다.`);
// console.log(`MERMAID CODE: \n${mermaid}`);

// --- Run agent (scenario 01) --- //
const stream = await app.stream(
  {
    messages: [
      {
        role: "user",
        content: "'교류전원을 사용하는 전동공구' 는 어떤 KC인증을 받아야해??",
      },
    ],
  },
  {
    configurable: {
      thread_id: "certification_test_id",
    },
  }
);

for await (const value of stream) {
  console.log("---STEP---");
  console.log(value);
  console.log("---END STEP---");
}

// const currentState = await app.getState({
//   configurable: { thread_id: "refund_testing_id" },
// });
// console.log("CURRENT TASKS", JSON.stringify(currentState.tasks, null, 2));

// console.log("NEXT TASKS", currentState.next);

// await app.updateState(
//   { configurable: { thread_id: "refund_testing_id" } },
//   {
//     refundAuthorized: true,
//   }
// );

// const resumedStream = await app.stream(null, {
//   configurable: { thread_id: "refund_testing_id" },
// });

// for await (const value of resumedStream) {
//   console.log(value);
// }

// --- Run agent (scenario 02) --- //
// const technicalStream = await app.stream(
//   {
//     messages: [
//       {
//         role: "user",
//         content:
//           "My LangCorp computer isn't turning on because I dropped it in water.",
//       },
//     ],
//   },
//   {
//     configurable: {
//       thread_id: "technical_testing_id",
//     },
//   }
// );

// for await (const value of technicalStream) {
//   console.log(value);
// }

// --- Run agent (scenario 03: Conversation) --- //
// const conversationalStream = await app.stream(
//   {
//     messages: [
//       {
//         role: "user",
//         content: "How are you? I'm Cobb.",
//       },
//     ],
//   },
//   {
//     configurable: {
//       thread_id: "conversational_testing_id",
//     },
//   }
// );

// for await (const value of conversationalStream) {
//   console.log(value);
// }
