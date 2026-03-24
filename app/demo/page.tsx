import type { Metadata } from "next";
import { DemoPage } from "@/components/demo/demo-page";

export const metadata: Metadata = {
  title: "OC Mid-Cap Fund — Investor Demo",
  description: "Talk to Robert Frost, Head of Investments at OC Funds Management.",
};

export default function Page() {
  return <DemoPage />;
}
