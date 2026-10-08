/// <reference types="vite/client" />
// AutoYT Docs (/docs, public): the product guide and the developer docs in one reading layout: section
// nav with search on the left, the article in a readable column, "on this page" on the right. The API
// reference reads /api/openapi.json live, so it always matches the deployed API.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Coins, Copy, Hash, Info, Link2, Loader2, Menu, Search, ShieldAlert, TriangleAlert, X } from "lucide-react";
import css from "./DocsPage.css?inline";
import { blockText, DOC_GROUPS, DOCS, type DocBlock, type DocPage, type DocSection } from "./docsContent";

// The styles ride inside this lazy chunk (one bundle file, not two).
function useDocsStyles() {
  useEffect(() => {
    if (document.getElementById("autoyt-docs-css")) return;
    const style = document.createElement("style");
    style.id = "autoyt-docs-css";
    style.textContent = css;
    document.head.appendChild(style);
  }, []);
}

/** In-app navigation: docs pages, then any other app path, without a full page load. */
function go(href: string) {
  const [path, hash] = href.split("#");
  if (path && path !== window.location.pathname) {
    window.history.pushState({ autoytNavigation: true, autoytFrom: window.location.pathname }, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } else if (hash) {
    window.history.replaceState(window.history.state, "", `#${hash}`);
  }
  if (hash) window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
}
function AppLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const external = !href.startsWith("/") || href.startsWith("/api/");
  return (
    <a
      href={href}
      className={className}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      onClick={(event) => {
        if (external || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        go(href);
      }}
    >
      {children}
    </a>
  );
}

/** **bold**, `code`, and [text](href). */
function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) parts.push(<strong key={match.index}>{match[1]}</strong>);
    else if (match[2]) parts.push(<code key={match.index} className="dx-ic">{match[2]}</code>);
    else parts.push(<AppLink key={match.index} href={match[4]} className="dx-a">{match[3]}</AppLink>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function CodeBlock({ code, label, lang }: { code: string; label?: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.replace(/ayt_…/g, "YOUR_TOKEN"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard blocked: the code stays selectable. */
    }
  };
  return (
    <figure className="dx-code">
      <figcaption>
        <span>{label || lang || "Code"}</span>
        <button type="button" onClick={() => void copy()} aria-label={copied ? "Copied" : `Copy ${label || "code"}`}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre><code>{code}</code></pre>
    </figure>
  );
}

function Block({ block }: { block: DocBlock }) {
  if ("p" in block) return <p><Inline text={block.p} /></p>;
  if ("h3" in block) return <h3>{block.h3}</h3>;
  if ("list" in block) return <ul className="dx-list">{block.list.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ul>;
  if ("steps" in block) return <ol className="dx-steps">{block.steps.map((item, i) => <li key={i}><Inline text={item} /></li>)}</ol>;
  if ("code" in block) return <CodeBlock code={block.code} label={block.label} lang={block.lang} />;
  if ("note" in block) {
    const Icon = block.tone === "warn" ? TriangleAlert : Info;
    return <aside className={`dx-note${block.tone === "warn" ? " is-warn" : ""}`}><Icon size={17} aria-hidden="true" /><p><Inline text={block.note} /></p></aside>;
  }
  return (
    <div className="dx-table" role="region" aria-label="Table" tabIndex={0}>
      <table>
        <thead><tr>{block.table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{block.table.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}><Inline text={cell} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function SectionView({ section }: { section: DocSection }) {
  return (
    <section className="dx-section" aria-labelledby={section.id}>
      <h2 id={section.id}>
        {section.title}
        <a href={`#${section.id}`} className="dx-anchor" aria-label={`Link to ${section.title}`} onClick={(event) => { event.preventDefault(); go(`#${section.id}`); void navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}#${section.id}`).catch(() => undefined); }}>
          <Hash size={16} aria-hidden="true" />
        </a>
      </h2>
      {section.blocks.map((block, i) => <Block key={i} block={block} />)}
    </section>
  );
}

// ---------- search ----------

type Hit = { page: DocPage; section?: DocSection; snippet: string; score: number };
function searchDocs(query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: Hit[] = [];
  for (const page of DOCS) {
    const pageText = `${page.title} ${page.lead}`.toLowerCase();
    if (words.every((w) => pageText.includes(w))) hits.push({ page, snippet: page.lead, score: 3 });
    for (const section of page.sections) {
      const body = section.blocks.map(blockText).join(" ").replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      const all = `${section.title} ${body}`.toLowerCase();
      if (!words.every((w) => all.includes(w))) continue;
      const at = body.toLowerCase().indexOf(words[0]);
      const snippet = at < 0 ? body.slice(0, 120) : `${at > 40 ? "…" : ""}${body.slice(Math.max(0, at - 40), at + 100)}…`;
      hits.push({ page, section, snippet, score: section.title.toLowerCase().includes(words[0]) ? 2 : 1 });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12);
}

function Mark({ text, query }: { text: string; query: string }) {
  const word = query.trim().split(/\s+/)[0];
  if (!word) return <>{text}</>;
  const at = text.toLowerCase().indexOf(word.toLowerCase());
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + word.length)}</mark>{text.slice(at + word.length)}</>;
}

// ---------- API reference (live) ----------

type Operation = { method: string; path: string; summary: string; description: string; tag: string; risk: string; scope?: string; spends: boolean; admin: boolean; params: string[] };
const RISK_LABEL: Record<string, string> = { read: "Read", change: "Change", paid: "Spends credits", publish: "Publishes", delete: "Deletes" };
const SCOPE_LABEL: Record<string, string> = { read: "Read only", create: "Create", full: "Full" };

function useOpenApi() {
  const [state, setState] = useState<{ ops: Operation[]; tags: Array<{ name: string; description: string }>; error: string } | null>(null);
  const load = () => {
    setState(null);
    fetch("/api/openapi.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`The API description didn't load (${r.status}).`))))
      .then((spec) => {
        const ops: Operation[] = [];
        for (const [path, methods] of Object.entries<any>(spec.paths || {})) {
          for (const [method, op] of Object.entries<any>(methods)) {
            ops.push({ method: method.toUpperCase(), path, summary: op.summary, description: op.description, tag: op.tags?.[0] || "Other", risk: op["x-risk"], scope: op["x-scope"], spends: Boolean(op["x-spends-credits"]), admin: Boolean(op["x-admin-only"]), params: (op.parameters || []).map((p: any) => p.name) });
          }
        }
        setState({ ops, tags: spec.tags || [], error: "" });
      })
      .catch((error) => setState({ ops: [], tags: [], error: error instanceof Error ? error.message : "The API description didn't load." }));
  };
  useEffect(load, []);
  return { state, reload: load };
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function Reference({ onSections }: { onSections: (sections: Array<{ id: string; title: string }>) => void }) {
  const { state, reload } = useOpenApi();
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState("all");
  const [open, setOpen] = useState("");
  const groups = useMemo(() => {
    if (!state) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const ops = state.ops.filter((op) => !op.admin && (risk === "all" || op.risk === risk) && words.every((w) => `${op.method} ${op.path} ${op.description} ${op.tag}`.toLowerCase().includes(w)));
    const names = state.tags.map((t) => t.name).filter((name) => ops.some((op) => op.tag === name));
    return names.map((name) => ({ name, brief: state.tags.find((t) => t.name === name)?.description || "", ops: ops.filter((op) => op.tag === name).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)) }));
  }, [state, query, risk]);
  useEffect(() => onSections(groups.map((g) => ({ id: slug(g.name), title: g.name }))), [groups, onSections]);

  if (!state) return <p className="dx-state"><Loader2 size={16} className="dx-spin" aria-hidden="true" />Loading the API description</p>;
  if (state.error) return <p className="dx-state is-error" role="alert"><TriangleAlert size={16} aria-hidden="true" />{state.error} <button type="button" className="dx-a" onClick={reload}>Try again</button></p>;
  const total = state.ops.filter((op) => !op.admin).length;
  const shown = groups.reduce((n, g) => n + g.ops.length, 0);
  return (
    <>
      <div className="dx-ref-tools">
        <label className="dx-field">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Filter ${total} routes: recap render, thumbnail, schedule…`} aria-label="Filter routes" />
          {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear filter"><X size={15} /></button> : null}
        </label>
        <div className="dx-chips" role="radiogroup" aria-label="Risk">
          {["all", "read", "change", "paid", "publish", "delete"].map((r) => (
            <button key={r} type="button" role="radio" aria-checked={risk === r} className={risk === r ? "is-on" : undefined} onClick={() => setRisk(r)}>{r === "all" ? "All" : RISK_LABEL[r]}</button>
          ))}
        </div>
        <p className="dx-ref-count" aria-live="polite">{shown === total ? `${total} routes` : `${shown} of ${total} routes`}</p>
      </div>
      {!groups.length ? <p className="dx-state">No routes match. Try fewer words.</p> : null}
      {groups.map((group) => (
        <section key={group.name} className="dx-section" aria-labelledby={slug(group.name)}>
          <h2 id={slug(group.name)}>{group.name}</h2>
          {group.brief ? <p className="dx-ref-brief">{group.brief.charAt(0).toUpperCase() + group.brief.slice(1)}.</p> : null}
          <ul className="dx-ops">
            {group.ops.map((op) => {
              const key = `${op.method} ${op.path}`;
              const isOpen = open === key;
              return (
                <li key={key} className={isOpen ? "is-open" : undefined}>
                  <button type="button" className="dx-op" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : key)}>
                    <span className="dx-method" data-method={op.method}>{op.method}</span>
                    <code className="dx-path">{op.path}</code>
                    <span className="dx-op-sum">{op.summary}</span>
                    {op.spends ? <Coins size={14} className="dx-op-coin" aria-label="Spends credits" /> : null}
                    <ChevronDown size={15} className="dx-op-chev" aria-hidden="true" />
                  </button>
                  {isOpen ? (
                    <div className="dx-op-body">
                      <p>{op.description}</p>
                      <dl className="dx-op-meta">
                        <div><dt>Risk</dt><dd>{RISK_LABEL[op.risk] || op.risk}</dd></div>
                        <div><dt>Token scope</dt><dd>{SCOPE_LABEL[op.scope || ""] || "Full"} or wider</dd></div>
                        <div><dt>Credits</dt><dd>{op.spends ? "Quoted and checked before it runs" : "Free"}</dd></div>
                        {op.params.length ? <div><dt>Path params</dt><dd>{op.params.map((p) => <code key={p} className="dx-ic">{p}</code>)}</dd></div> : null}
                      </dl>
                      <CodeBlock label="Example" lang="bash" code={`curl${op.method === "GET" ? "" : ` -X ${op.method}`} https://autoyt.cc${op.path.replace(/\{(\w+)\}/g, (_m, p) => `<${p}>`)} \\\n  -H "Authorization: Bearer ayt_…"${op.method === "POST" || op.method === "PUT" || op.method === "PATCH" ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '{}'` : ""}`} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

// ---------- the page ----------

export default function DocsPage({ page: pageId, signedIn, onSignIn }: { page?: string; signedIn: boolean; onSignIn: () => void }) {
  useDocsStyles();
  const page = DOCS.find((p) => p.id === pageId) || DOCS[0];
  const index = DOCS.indexOf(page);
  const prev = DOCS[index - 1];
  const next = DOCS[index + 1];
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [refSections, setRefSections] = useState<Array<{ id: string; title: string }>>([]);
  const [current, setCurrent] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchDocs(query), [query]);
  const toc = page.reference ? refSections : page.sections.map((s) => ({ id: s.id, title: s.title }));

  useEffect(() => {
    document.title = `${page.title} · AutoYT Docs`;
    setMenuOpen(false);
    setQuery("");
    const hash = window.location.hash.slice(1);
    if (hash) window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }), 60);
    else scroller.current?.scrollTo({ top: 0 });
    return () => {
      document.title = "AutoYT";
    };
  }, [page.id, page.title]);

  // "/" focuses search, as on most docs sites.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === "/" && !/input|textarea|select/i.test(target.tagName) && !target.isContentEditable) {
        event.preventDefault();
        setMenuOpen(true);
        searchField.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // On this page: the section being read.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !toc.length) return;
    const headings = toc.map((t) => document.getElementById(t.id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setCurrent(visible[0].target.id);
    }, { root, rootMargin: "0px 0px -70% 0px" });
    headings.forEach((h) => observer.observe(h));
    setCurrent(toc[0]?.id || "");
    return () => observer.disconnect();
  }, [page.id, toc]);

  const nav = (
    <nav className="dx-nav" aria-label="Docs">
      <label className="dx-field dx-search">
        <Search size={16} aria-hidden="true" />
        <input
          ref={searchField}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && hits[0]) go(`/docs/${hits[0].page.id}${hits[0].section ? `#${hits[0].section.id}` : ""}`);
            if (event.key === "Escape") setQuery("");
          }}
          placeholder="Search the docs"
          aria-label="Search the docs"
        />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button> : <kbd>/</kbd>}
      </label>
      {query ? (
        <div className="dx-results" aria-live="polite">
          {hits.length ? hits.map((hit, i) => (
            <AppLink key={i} href={`/docs/${hit.page.id}${hit.section ? `#${hit.section.id}` : ""}`} className="dx-result">
              <strong><Mark text={hit.section ? `${hit.page.title} › ${hit.section.title}` : hit.page.title} query={query} /></strong>
              <span><Mark text={hit.snippet} query={query} /></span>
            </AppLink>
          )) : <p className="dx-state">Nothing matches "{query}".</p>}
        </div>
      ) : (
        DOC_GROUPS.map((group) => (
          <div key={group} className="dx-group">
            <h2>{group}</h2>
            <ul>
              {DOCS.filter((p) => p.group === group).map((p) => (
                <li key={p.id}>
                  <AppLink href={p.id === "introduction" ? "/docs" : `/docs/${p.id}`} className={`dx-navlink${p.id === page.id ? " is-current" : ""}`}>
                    <span aria-current={p.id === page.id ? "page" : undefined}>{p.title}</span>
                  </AppLink>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </nav>
  );

  return (
    <div className="dx" ref={scroller}>
      <div className="dx-shell">
        <aside className={`dx-side${menuOpen ? " is-open" : ""}`}>
          <div className="dx-side-head">
            <AppLink href="/docs" className="dx-brand">AutoYT <span>Docs</span></AppLink>
            <button type="button" className="dx-menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              {menuOpen ? <X size={16} aria-hidden="true" /> : <Menu size={16} aria-hidden="true" />}
              <span>{menuOpen ? "Close" : page.title}</span>
            </button>
          </div>
          {nav}
          {!signedIn ? (
            <div className="dx-side-cta">
              <p>Try it on your own channel.</p>
              <button type="button" className="dx-btn" onClick={onSignIn}>Sign in with Google</button>
            </div>
          ) : null}
        </aside>

        <main className="dx-main" id="docs-content">
          <article className="dx-article">
            <h1>{page.title}</h1>
            <p className="dx-lead">{page.lead}</p>
            {page.reference ? (
              <>
                <aside className="dx-note"><ShieldAlert size={17} aria-hidden="true" /><p>Send a token on every call (see <AppLink href="/docs/authentication" className="dx-a">Authentication</AppLink>). Routes marked with a coin spend credits and are checked against your balance first. Also available as <AppLink href="/api/openapi.json" className="dx-a">openapi.json</AppLink>.</p></aside>
                <Reference onSections={setRefSections} />
              </>
            ) : (
              page.sections.map((section) => <SectionView key={section.id} section={section} />)
            )}
            <nav className="dx-pager" aria-label="Pages">
              {prev ? (
                <AppLink href={prev.id === "introduction" ? "/docs" : `/docs/${prev.id}`} className="dx-pager-link">
                  <span><ArrowLeft size={14} aria-hidden="true" />Previous</span>
                  <strong>{prev.title}</strong>
                </AppLink>
              ) : <span />}
              {next ? (
                <AppLink href={`/docs/${next.id}`} className="dx-pager-link is-next">
                  <span>Next<ArrowRight size={14} aria-hidden="true" /></span>
                  <strong>{next.title}</strong>
                </AppLink>
              ) : null}
            </nav>
            <p className="dx-foot">Something missing or wrong? Ask Juel in the app, or contact support from <AppLink href="/account/security" className="dx-a">Account &gt; Security</AppLink>.</p>
          </article>
        </main>

        {toc.length > 1 ? (
          <aside className="dx-toc" aria-label="On this page">
            <h2><Link2 size={13} aria-hidden="true" />On this page</h2>
            <ul>
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className={current === t.id ? "is-current" : undefined} onClick={(event) => { event.preventDefault(); go(`#${t.id}`); }}>{t.title}</a>
                </li>
              ))}
            </ul>
          </aside>
        ) : <span className="dx-toc-space" />}
      </div>
    </div>
  );
}

