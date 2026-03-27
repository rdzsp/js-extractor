// content.js - Injected into every page, listens for extraction requests

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extract') {
    const patterns = message.patterns;
    extractFromPage(patterns).then(results => {
      sendResponse({ success: true, results });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // keep channel open for async
  }
});

async function extractFromPage(patterns) {
  const sources = [];

  // 1. Inline <script> blocks
  const inlineScripts = document.querySelectorAll('script:not([src])');
  inlineScripts.forEach((el, i) => {
    const content = el.textContent.trim();
    if (content) {
      sources.push({ label: `inline-script-${i + 1}`, content });
    }
  });

  // 2. External <script src="..."> files
  const externalScripts = Array.from(document.querySelectorAll('script[src]'));
  const fetchPromises = externalScripts.map(async (el) => {
    const src = el.getAttribute('src');
    const fullUrl = new URL(src, document.baseURI).href;
    try {
      const res = await fetch(fullUrl, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return { label: fullUrl, content: text };
    } catch (e) {
      return { label: fullUrl, content: '', error: e.message };
    }
  });

  const fetched = await Promise.all(fetchPromises);
  fetched.forEach(s => { if (s.content) sources.push(s); });

  // 3. Run each pattern against each source
  const results = [];

  for (const pattern of patterns) {
    let regex;
    try {
      regex = new RegExp(pattern.regex, 'gm');
    } catch (e) {
      results.push({
        patternId: pattern.id,
        patternRegex: pattern.regex,
        description: pattern.description,
        error: `Invalid regex: ${e.message}`,
        matches: []
      });
      continue;
    }

    const patternMatches = [];
    for (const source of sources) {
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(source.content)) !== null) {
        patternMatches.push({
          value: match[0],
          captured: match[1] !== undefined ? match[1] : null,
          source: source.label,
          index: match.index
        });
        // Prevent infinite loop on zero-length matches
        if (match[0].length === 0) regex.lastIndex++;
      }
    }

    results.push({
      patternId: pattern.id,
      patternRegex: pattern.regex,
      description: pattern.description,
      matches: patternMatches
    });
  }

  return results;
}
