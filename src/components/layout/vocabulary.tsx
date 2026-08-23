"use client";

import { createContext, useContext } from "react";
import { DEFAULT_VOCABULARY, type OrgVocabulary } from "@/lib/org/vocabulary";

/**
 * The workspace's own words, available to every Client Component under the app
 * shell. Resolved once on the server (see the (app) layout) and handed down, so
 * a screen never has to fetch, re-derive, or hardcode them.
 *
 * The fallback is the neutral general vertical — a component rendered outside
 * the shell should read "lead", never another industry's noun.
 */
const VocabularyContext = createContext<OrgVocabulary>(DEFAULT_VOCABULARY);

export function VocabularyProvider({
  value,
  children,
}: {
  value: OrgVocabulary;
  children: React.ReactNode;
}) {
  return (
    <VocabularyContext.Provider value={value}>{children}</VocabularyContext.Provider>
  );
}

export function useVocabulary(): OrgVocabulary {
  return useContext(VocabularyContext);
}
