/** Group codes: a memorable word + 3 digits, e.g. MANGO427. */

const WORD_LIST: readonly string[] = [
  'APPLE','MANGO','GRAPE','LEMON','LIME','PEACH','PLUM','PEAR',
  'MELON','BERRY','KIWI','FIG','DATE','GUAVA','PAPAYA','LYCHEE',
  'OLIVE','CHERRY','ORANGE','BANANA','LOTUS','ROSE','TULIP','IRIS',
  'DAISY','FERN','PALM','CEDAR','MAPLE','OAK','ASH','ELM',
  'PINE','BIRCH','WILLOW','CORAL','AMBER','JADE','RUBY','ONYX',
  'OPAL','TOPAZ','PEARL','IVORY','EBONY','SANDY','AZURE','CRIMSON',
  'TEAL','INDIGO','VIOLET','CYAN','SCARLET','GOLDEN','SILVER','BRONZE',
  'COPPER','MAROON','NAVY','MINT','SAGE','DUNE','REEF','CREEK',
  'CREST','BROOK','CLIFF','GROVE','BLAZE','STORM','CLOUD','MIST',
  'FROST','FLAME','SPARK','EMBER','GALE','TIDE','WAVE','COVE',
  'VALE','RIDGE','PEAK','GLEN','DELL','FORD','KNOLL','MOOR',
  'SHIRE','HEATH','MARSH','BAYOU','DELTA','DUSK','DAWN','NOON',
  'NIGHT','STAR','COMET','ORBIT','SOLAR','LUNAR','NOVA','ZENITH',
  'TIGER','EAGLE','FALCON','HAWK','RAVEN','CRANE','HERON','SWIFT',
  'WREN','FINCH','ROBIN','LARK','DOVE','IBIS','EGRET','MARTIN',
  'OWL','KITE','BUNNY','FOX','WOLF','BEAR','LYNX','PANDA',
  'COBRA','GECKO','SABLE','TAWNY','DUSKY','MOCHA','HAZEL','OCHRE',
  'TAUPE','UMBER','SIENNA','BISQUE','ALMOND','WALNUT','MINK','SLATE',
  'STONE','FLINT','SHALE','ALPHA','BRAVO','ECHO',
];

// ponytail: ~150k codes total; reuse codes of long-expired groups if that ever runs low.
function generateCode(): string {
  const word = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
  return word + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

/** Retries random codes until `isCodeTaken` says no; throws after `maxRetries`. */
export async function generateUniqueCode(
  isCodeTaken: (code: string) => Promise<boolean>,
  maxRetries = 10,
): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const code = generateCode();
    if (!(await isCodeTaken(code))) return code;
  }
  throw new Error('Could not generate a unique group code after maximum retries');
}
