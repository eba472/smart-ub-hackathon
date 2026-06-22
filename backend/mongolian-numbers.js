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
  return text.replace(/(\d+)(\s+[а-яА-ЯёЁөӨүҮa-zA-Z]+)?/g, (_, numStr, followingWord) => {
    const num = parseInt(numStr, 10);
    const isAttr = !!(followingWord && followingWord.trim().length > 0);
    const inWords = mongolianNumToWords(num, isAttr);
    return followingWord ? inWords + followingWord : inWords;
  });
}
