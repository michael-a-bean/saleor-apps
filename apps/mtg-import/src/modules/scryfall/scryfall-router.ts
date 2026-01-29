import { z } from "zod";

import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

import { getCacheMetadata, clearCache, getEnglishPaperCards } from "./cache";
import { getAllSets, getSet, getCardsForSet, groupCardsBySet } from "./client";

export const scryfallRouter = router({
  /**
   * Get cache metadata
   */
  getCacheStatus: protectedClientProcedure.query(async () => {
    const metadata = await getCacheMetadata();
    return {
      cached: metadata !== null,
      metadata,
    };
  }),

  /**
   * Refresh the Scryfall cache
   */
  refreshCache: protectedClientProcedure.mutation(async () => {
    await clearCache();
    const cards = await getEnglishPaperCards(true);
    return {
      success: true,
      cardCount: cards.length,
    };
  }),

  /**
   * Get all sets from Scryfall
   */
  getSets: protectedClientProcedure.query(async () => {
    const sets = await getAllSets();

    // Filter to paper sets and sort by release date (newest first)
    const paperSets = sets
      .filter((s) => !s.digital)
      .sort((a, b) => {
        if (!a.released_at) return 1;
        if (!b.released_at) return -1;
        return new Date(b.released_at).getTime() - new Date(a.released_at).getTime();
      });

    return paperSets;
  }),

  /**
   * Get a specific set by code
   */
  getSet: protectedClientProcedure
    .input(z.object({ setCode: z.string().min(1).max(10) }))
    .query(async ({ input }) => {
      return getSet(input.setCode);
    }),

  /**
   * Get cards for a specific set
   */
  getSetCards: protectedClientProcedure
    .input(z.object({ setCode: z.string().min(1).max(10) }))
    .query(async ({ input }) => {
      const cards = await getCardsForSet(input.setCode);
      return {
        setCode: input.setCode,
        cardCount: cards.length,
        cards,
      };
    }),

  /**
   * Get bulk data statistics (grouped by set)
   */
  getBulkStats: protectedClientProcedure.query(async () => {
    const cards = await getEnglishPaperCards();
    const setGroups = groupCardsBySet(cards);

    const setStats = Array.from(setGroups.entries())
      .map(([setCode, setCards]) => ({
        setCode,
        setName: setCards[0]?.set_name || setCode,
        cardCount: setCards.length,
      }))
      .sort((a, b) => b.cardCount - a.cardCount);

    return {
      totalCards: cards.length,
      setCount: setStats.length,
      sets: setStats,
    };
  }),
});
