const base = (process.env.API_BASE || "http://localhost:8000").replace(/\/$/, "");

async function probe(path) {
  const url = `${base}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return { path, status: res.status, ok: res.ok };
  } catch (e) {
    clearTimeout(t);
    return { path, error: e instanceof Error ? e.message : String(e), ok: false };
  }
}

async function main() {
  const checks = [
    await probe("/"),
    await probe("/master/health-check").catch(() => probe("/health")),
  ];
  const failed = checks.filter((c) => !c.ok);
  console.log(JSON.stringify({ base, checks }, null, 2));
  if (failed.length) {
    console.error("Smoke failed:", failed);
    process.exit(1);
  }
  console.log("Live lesson smoke: API reachable");
}

main();
