import type { Metadata } from "next";
import { GamesWorkspace } from "@/components/games/GamesWorkspace";

export const metadata: Metadata = { title: "Learning games" };

export default function GamesPage() {
  return <GamesWorkspace />;
}
