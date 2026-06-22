/**
 * Converts a non-negative integer to its spoken Mongolian word form.
 * isAttribute=true uses modifier forms (e.g. "гурван" vs "гурав") for
 * numbers that precede a noun or another number component.
 */
export function mongolianNumToWords(num, isAttribute = false) {
  if (num === 0) return "тэг";

  const onesBase = ["", "нэг", "хоёр", "гурав", "дөрөв", "тав", "зургаа", "долоо", "найм", "ес"];
  const onesMod  = ["", "нэг", "хоёр", "гурван", "дөрвөн", "таван", "зургаан", "долоон", "найман", "есөн"];
  const tensBase = ["", "арав", "хорь", "гуч", "дөч", "тавь", "жар", "дал", "ная", "ер"];
  const tensMod  = ["", "арван", "хорин", "гучин", "дөчин", "тавин", "жаран", "далан", "наян", "ерэн"];

  function processHundreds(n, hasNextChunk, isLastChunk) {
    const words = [];
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const o = n % 10;
    const hasSub = t > 0 || o > 0;

    if (h > 0) {
      words.push(onesMod[h]);
      words.push(hasSub || hasNextChunk || (isLastChunk && isAttribute) ? "зуун" : "зуу");
    }
    if (t > 0) {
      words.push(o > 0 || hasNextChunk || (isLastChunk && isAttribute) ? tensMod[t] : tensBase[t]);
    }
    if (o > 0) {
      words.push(hasNextChunk || (isLastChunk && isAttribute) ? onesMod[o] : onesBase[o]);
    }
    return words;
  }

  // Split into 3-digit chunks: [ones, thousands, millions, ...]
  const chunks = [];
  let temp = num;
  while (temp > 0) {
    chunks.push(temp % 1000);
    temp = Math.floor(temp / 1000);
  }

  const chunkNamesBase = ["", "мянга", "сая", "тэрбум", "наяд"];
  const chunkNamesMod  = ["", "мянган", "сая", "тэрбум", "наяд"];

  const words = [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    if (c === 0) continue;

    const hasNextChunk = chunks.slice(0, i).some(x => x > 0);
    const isLastChunk  = i === 0;

    const chunkWords = processHundreds(c, hasNextChunk || chunkNamesBase[i] !== "", isLastChunk);
    words.push(...chunkWords);

    if (i > 0) {
      words.push(hasNextChunk || isAttribute ? chunkNamesMod[i] : chunkNamesBase[i]);
    }
  }

  return words.join(" ");
}

/**
 * Replaces all digit sequences in a Mongolian text string with their
 * spoken word equivalents. Numbers followed by a word use modifier forms.
 */
export function normalizeMongolianNumbers(text) {
  // 1. Expand common symbols into words first so they trigger the attribute forms (e.g., "мянган")
  let processedText = text
    .replace(/₮/g, " төгрөг")
    .replace(/%/g, " хувь");

  // 2. Match numbers with optional thousands separators (comma, apostrophe, period, or space)
  // This safely captures "40,000", "40'000", "40 000", or just "40000"
  const numberRegex = /(\d{1,3}(?:[.,' ]\d{3})+|\d+)(\s*[а-яА-ЯёЁөӨүҮa-zA-Z]+)?/g;

  return processedText.replace(numberRegex, (_, numStr, followingWord) => {
    // 3. Strip out the separators to parse the integer cleanly
    const cleanNumStr = numStr.replace(/[.,' ]/g, "");
    const num = parseInt(cleanNumStr, 10);
    
    // 4. Determine if it's modifying a following word
    const isAttr = !!(followingWord && followingWord.trim().length > 0);
    const inWords = mongolianNumToWords(num, isAttr);
    
    return followingWord ? inWords + followingWord : inWords;
  });
}
