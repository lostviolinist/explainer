import { serve } from "inngest/next";
import { inngest } from "@explainer/pipeline";
import { functions } from "@/lib/pipeline";

export const maxDuration = 300;
export const { GET, POST, PUT } = serve({ client: inngest, functions });
