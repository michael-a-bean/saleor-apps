/**
 * MTGJSON Module
 *
 * Provides MTGJSON data as a fallback source when Scryfall is unavailable.
 * - card-adapter: converts MTGJSON cards to ScryfallCard shape
 * - bulk-data: downloads and streams AllPrintings.json
 */

export { adaptMtgjsonCard, adaptMtgjsonSet, buildScryfallImageUri } from "./card-adapter";
export type { MtgjsonCard, MtgjsonSet, MtgjsonCardIdentifiers } from "./card-adapter";
export { MtgjsonBulkDataManager } from "./bulk-data";
export type { MtgjsonBulkOptions } from "./bulk-data";
