import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { executeWorkflow } from "@/inngest/functions";

console.log(executeWorkflow);

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [executeWorkflow],
});



