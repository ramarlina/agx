"use client";

import { use } from "react";
import { PrReviewView } from "@/components/prs/review/PrReviewView";

interface PageProps {
  params: Promise<{ slug: string; prId: string }>;
}

export default function PrReviewPage({ params }: PageProps) {
  const { prId } = use(params);
  return <PrReviewView prId={prId} />;
}
