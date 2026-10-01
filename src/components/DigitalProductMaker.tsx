import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BookOpen, Check, ChevronLeft, ChevronRight, Download, Eye, FileText, Image as ImageIcon, LoaderCircle, Plus, Save, Trash2, WandSparkles } from "lucide-react";
import { creatorApi } from "./CreatorWorkspace";
import { toast } from "../utils/toast";
import { writeDeepLink } from "../utils/tiktokRoute";
import "./DigitalProductMaker.css";

type Chapter = { n: number; title: string; body: string };
type DigitalBook = {
  title: string; subtitle: string; description: string; author: string; audience: string;
  genre: string; idea: string; tone: string; coverPrompt: string; coverUrl: string;
  chapters: Chapter[]; generatedAt?: number;
};
type Product = { id: string; title: string; data: DigitalBook; updatedAt: string };
type StoryBibleSource = { id: string; title: string; logline: string; premise: string; genre: string };
type Tab = "write" | "cover" | "read";
const blankBook = (title = "Untitled book"): DigitalBook => ({ title, subtitle: "", description: "", author: "", audience: "", genre: "", idea: "", tone: "", coverPrompt: "", coverUrl: "", chapters: [] });

export function DigitalProductMaker({ theme, initialProductId, initialTab }: { theme: "light" | "dark"; initialProductId?: string; initialTab?: Tab }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [storyBibles, setStoryBibles] = useState<StoryBibleSource[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<DigitalBook>(blankBook());
  const [tab, setTab] = useState<Tab>(initialTab || "write");
  const [chapterIndex, setChapterIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [covering, setCovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const routeSelection = useRef({ productId: initialProductId || "", tab: initialTab || "write" as Tab });

  const selected = products.find((item) => item.id === selectedId);
  const activeChapter = draft.chapters[chapterIndex];
  const coverUrl = useMemo(() => draft.coverUrl ? `${draft.coverUrl}${draft.coverUrl.includes("?") ? "&" : "?"}v=${selected?.updatedAt || ""}` : "", [draft.coverUrl, selected?.updatedAt]);

  async function refresh(preferId = selectedId) {
    const result = await creatorApi("/api/digital-products");
    const next = result.products as Product[];
    setProducts(next);
    const id = next.some((item) => item.id === preferId) ? preferId : next[0]?.id || "";
    setSelectedId(id);
    const found = next.find((item) => item.id === id);
    setDraft(found?.data || blankBook());
    setChapterIndex(0);
    setDirty(false);
  }

  useEffect(() => {
    let alive = true;
    creatorApi("/api/digital-products")
      .then((result) => {
        if (!alive) return;
        const next = result.products as Product[];
        setProducts(next);
        const requested = next.find((item) => item.id === initialProductId) || next[0];
        setSelectedId(requested?.id || "");
        setDraft(requested?.data || blankBook());
        if (initialProductId && !next.some((item) => item.id === initialProductId)) {
          writeDeepLink({ view: "products" }, true);
        }
      })
      .catch((error) => toast.error(error))
      .finally(() => alive && setLoading(false));
    creatorApi("/api/digital-products/story-bibles")
      .then((result) => alive && setStoryBibles(result.storyBibles || []))
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const targetId = initialProductId || "";
    const targetTab = initialTab || "write";
    const previous = routeSelection.current;
    if (previous.productId === targetId && previous.tab === targetTab) return;
    if (dirty && !window.confirm("Discard unsaved edits and open this product page?")) {
      writeDeepLink({ view: "products", productId: selectedId || undefined, productTab: tab }, true);
      return;
    }
    routeSelection.current = { productId: targetId, tab: targetTab };
    setTab(targetTab);
    if (targetId !== selectedId) {
      const product = products.find((item) => item.id === targetId);
      if (product) {
        setSelectedId(product.id);
        setDraft(product.data);
        setChapterIndex(0);
        setDirty(false);
      }
    }
  }, [dirty, initialProductId, initialTab, products, selectedId, tab]);

  function pick(item: Product) {
    if (dirty && !window.confirm("Discard unsaved edits and open another product?")) return;
    setSelectedId(item.id);
    setDraft(item.data);
    setChapterIndex(0);
    setDirty(false);
    setTab("write");
    routeSelection.current = { productId: item.id, tab: "write" };
    writeDeepLink({ view: "products", productId: item.id, productTab: "write" });
  }

  function changeTab(next: Tab) {
    setTab(next);
    routeSelection.current = { productId: selectedId, tab: next };
    writeDeepLink({ view: "products", productId: selectedId || undefined, productTab: next });
  }

  async function createBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const idea = String(form.get("idea") || "");
    const sourceDramaId = String(form.get("sourceDramaId") || "");
    if (idea.trim().length < 24 && !sourceDramaId) {
      toast.error("Describe your idea or choose a drama story bible to adapt");
      return;
    }
    setCreating(true);
    try {
      const result = await creatorApi("/api/digital-products", {
        title: String(form.get("title") || "Untitled book"),
        idea,
        sourceDramaId,
        genre: String(form.get("genre") || ""),
        audience: String(form.get("audience") || ""),
        tone: String(form.get("tone") || ""),
      });
      await refresh(result.product.id);
      writeDeepLink({ view: "products", productId: result.product.id, productTab: "write" });
      setCreateOpen(false);
      setTab("write");
      toast.success("Product created");
    } catch (error) { toast.error(error); }
    finally { setCreating(false); }
  }

  async function save(next = draft) {
    if (!selectedId) return false;
    setSaving(true);
    try {
      const result = await creatorApi(`/api/digital-products/${encodeURIComponent(selectedId)}`, { data: next }, "PUT");
      setDraft(result.product.data);
      setProducts((items) => items.map((item) => item.id === selectedId ? result.product : item));
      setDirty(false);
      return true;
    } catch (error) { toast.error(error); return false; }
    finally { setSaving(false); }
  }

  async function generateBook() {
    if (dirty && !(await save())) return;
    setGenerating(true);
    try {
      const result = await creatorApi(`/api/digital-products/${encodeURIComponent(selectedId)}/generate`, {});
      setDraft(result.product.data);
      setProducts((items) => items.map((item) => item.id === selectedId ? result.product : item));
      setChapterIndex(0);
      setDirty(false);
      toast.success("Manuscript draft is ready to edit");
    } catch (error) { toast.error(error); }
    finally { setGenerating(false); }
  }

  async function generateCover() {
    if (dirty && !(await save())) return;
    setCovering(true);
    try {
      const result = await creatorApi(`/api/digital-products/${encodeURIComponent(selectedId)}/cover`, { prompt: draft.coverPrompt });
      setDraft(result.product.data);
      setProducts((items) => items.map((item) => item.id === selectedId ? result.product : item));
      setDirty(false);
      toast.success("Cover artwork generated");
    } catch (error) { toast.error(error); }
    finally { setCovering(false); }
  }

  async function removeBook() {
    if (!selectedId || !window.confirm(`Delete “${draft.title}” and its manuscript? This cannot be undone.`)) return;
    try {
      await creatorApi(`/api/digital-products/${encodeURIComponent(selectedId)}`, undefined, "DELETE");
      await refresh("");
      writeDeepLink({ view: "products" });
      toast.success("Product deleted");
    } catch (error) { toast.error(error); }
  }

  function update(patch: Partial<DigitalBook>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  }
  function updateChapter(patch: Partial<Chapter>) {
    setDraft((current) => ({ ...current, chapters: current.chapters.map((chapter, index) => index === chapterIndex ? { ...chapter, ...patch } : chapter) }));
    setDirty(true);
  }
  function exportMarkdown() {
    const text = [`# ${draft.title}`, draft.subtitle, draft.author ? `By ${draft.author}` : "", draft.description, ...draft.chapters.flatMap((chapter) => [`## ${chapter.title}`, chapter.body])].filter(Boolean).join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "digital-book"}.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <main className="dpm" data-theme={theme}>
      <aside className="dpm-rail" aria-label="Digital products">
        <div className="dpm-rail-head"><div className="dpm-brand"><BookOpen size={18} strokeWidth={1.8} /><span>Products</span></div><button type="button" className="dpm-add" aria-label="Create a digital product" onClick={() => setCreateOpen(true)}><Plus size={17} /></button></div>
        <div className="dpm-library-title">Your products <span>{products.length}</span></div>
        <div className="dpm-library">
          {loading ? <div className="dpm-loading"><LoaderCircle size={17} className="dpm-spin" /> Loading products</div> : products.map((item) => (
            <button key={item.id} type="button" className={`dpm-product ${item.id === selectedId ? "is-selected" : ""}`} onClick={() => pick(item)}>
              <span className="dpm-product-cover">{item.data.coverUrl ? <img src={item.data.coverUrl} alt="" /> : <BookOpen size={17} />}</span>
              <span className="dpm-product-copy"><strong>{item.title}</strong><small>{item.data.chapters.length ? `${item.data.chapters.length} chapters` : "Idea draft"}</small></span>
            </button>
          ))}
          {!loading && !products.length && <p className="dpm-library-empty">Your book projects will appear here.</p>}
        </div>
        <button type="button" className="dpm-new-book" onClick={() => setCreateOpen(true)}><Plus size={15} /> New product</button>
      </aside>

      <section className="dpm-main">
        {createOpen ? (
          <div className="dpm-create-wrap">
            <form className="dpm-create" onSubmit={(event) => void createBook(event)}>
              <h1>Start a digital product</h1>
              <p>Shape an idea into an editable manuscript, create its cover art, then preview it as a reader would.</p>
              <label>Working title<input name="title" maxLength={140} placeholder="The small book of…" /></label>
              {storyBibles.length > 0 && <label>Start from a drama series<select name="sourceDramaId" defaultValue=""><option value="">Start with a new idea</option>{storyBibles.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label>}
              <label>What should this product be about?<textarea name="idea" maxLength={5000} rows={5} placeholder="Describe the reader, the promise, and what they should be able to do or feel by the end. Leave blank to adapt the selected series." /></label>
              <div className="dpm-form-row"><label>Genre or category<input name="genre" maxLength={80} placeholder="Practical guide, romance, workbook…" /></label><label>For whom?<input name="audience" maxLength={240} placeholder="Who will use or read it?" /></label></div>
              <label>Voice or tone<input name="tone" maxLength={120} placeholder="Warm, direct, cinematic…" /></label>
              <div className="dpm-create-actions"><button type="button" className="dpm-secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button className="dpm-primary" disabled={creating}>{creating ? <LoaderCircle size={16} className="dpm-spin" /> : <Plus size={16} />} {creating ? "Creating…" : "Create project"}</button></div>
            </form>
          </div>
        ) : !selected ? (
          <div className="dpm-empty"><div className="dpm-empty-icon"><BookOpen size={24} /></div><h1>Your next book starts here.</h1><p>Create a guide, workbook, story, or reader-ready digital book from one clear idea.</p><button className="dpm-primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Start a product</button></div>
        ) : (
          <>
            <header className="dpm-topbar">
              <div className="dpm-title-wrap"><input aria-label="Product title" value={draft.title} maxLength={140} onChange={(event) => update({ title: event.target.value })} /></div>
              <div className="dpm-top-actions">
                <button type="button" className="dpm-secondary dpm-icon-label" onClick={removeBook} title="Delete product"><Trash2 size={15} /><span>Delete</span></button>
                <button type="button" className="dpm-secondary dpm-icon-label" onClick={exportMarkdown} disabled={!draft.chapters.length} title="Export manuscript"><Download size={15} /><span>Export</span></button>
                <button type="button" className="dpm-primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? <LoaderCircle size={15} className="dpm-spin" /> : dirty ? <Save size={15} /> : <Check size={15} />}{saving ? "Saving" : dirty ? "Save" : "Saved"}</button>
              </div>
            </header>
            <nav className="dpm-tabs" aria-label="Product editor">
              {([["write", FileText, "Manuscript"], ["cover", ImageIcon, "Cover art"], ["read", Eye, "Reader preview"]] as const).map(([id, Icon, label]) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => changeTab(id)}><Icon size={15} />{label}</button>)}
              <button type="button" className="dpm-generate" disabled={generating || !draft.idea.trim()} onClick={() => void generateBook()}>{generating ? <LoaderCircle size={15} className="dpm-spin" /> : <WandSparkles size={15} />}{generating ? "Writing your draft…" : draft.chapters.length ? "Regenerate draft" : "Generate manuscript"}</button>
            </nav>
            {tab === "write" ? <section className="dpm-editor">
              <div className="dpm-editor-aside"><div className="dpm-section-label">Manuscript</div><label>Subtitle<input value={draft.subtitle} maxLength={220} placeholder="A clear promise to the reader" onChange={(event) => update({ subtitle: event.target.value })} /></label><label>Author<input value={draft.author} maxLength={100} placeholder="Author name" onChange={(event) => update({ author: event.target.value })} /></label><label>Product description<textarea rows={5} value={draft.description} maxLength={1800} placeholder="A short description for your product page" onChange={(event) => update({ description: event.target.value })} /></label><label>Core idea<textarea rows={5} value={draft.idea} maxLength={5000} placeholder="What is this product about?" onChange={(event) => update({ idea: event.target.value })} /></label><button type="button" className="dpm-secondary dpm-full" onClick={() => setTab("cover")}><ImageIcon size={15} /> Design the cover</button></div>
              <div className="dpm-chapter-editor">{draft.chapters.length ? <><div className="dpm-chapter-head"><div><span className="dpm-section-label">Chapter {String(chapterIndex + 1).padStart(2, "0")} of {String(draft.chapters.length).padStart(2, "0")}</span><h2>Shape the chapter</h2></div><div className="dpm-chapter-nav"><button aria-label="Previous chapter" disabled={chapterIndex <= 0} onClick={() => setChapterIndex((value) => value - 1)}><ChevronLeft size={16} /></button><button aria-label="Next chapter" disabled={chapterIndex >= draft.chapters.length - 1} onClick={() => setChapterIndex((value) => value + 1)}><ChevronRight size={16} /></button></div></div><label className="dpm-chapter-title">Chapter title<input value={activeChapter?.title || ""} maxLength={140} onChange={(event) => updateChapter({ title: event.target.value })} /></label><textarea className="dpm-manuscript" aria-label="Chapter manuscript" value={activeChapter?.body || ""} placeholder="Your chapter draft will appear here…" onChange={(event) => updateChapter({ body: event.target.value })} /><div className="dpm-word-count">{(activeChapter?.body || "").trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words</div><ol className="dpm-chapter-strip">{draft.chapters.map((chapter, index) => <li key={chapter.n}><button type="button" aria-current={chapterIndex === index ? "step" : undefined} onClick={() => setChapterIndex(index)}><span>{String(index + 1).padStart(2, "0")}</span>{chapter.title}</button></li>)}</ol></> : <div className="dpm-no-chapters"><FileText size={23} /><h2>Build the first draft</h2><p>Generate a five-chapter starting manuscript from your idea. Everything stays editable.</p><button className="dpm-primary" disabled={generating || !draft.idea.trim()} onClick={() => void generateBook()}>{generating ? <LoaderCircle size={15} className="dpm-spin" /> : <WandSparkles size={15} />} {generating ? "Writing…" : "Generate manuscript"}</button></div>}</div>
            </section> : null}
            {tab === "cover" ? <section className="dpm-cover-stage"><div className="dpm-cover-controls"><span className="dpm-section-label">Cover design</span><h2>Give the book a strong first impression.</h2><p>Artwork is generated from the product’s reader promise and can be refined with your own direction.</p><label>Cover art direction<textarea rows={7} maxLength={1600} value={draft.coverPrompt} placeholder="Generate a manuscript to propose a cover, or describe the art direction here." onChange={(event) => update({ coverPrompt: event.target.value })} /></label><button type="button" className="dpm-primary dpm-full" disabled={covering || !draft.coverPrompt.trim()} onClick={() => void generateCover()}>{covering ? <LoaderCircle size={15} className="dpm-spin" /> : <WandSparkles size={15} />}{covering ? "Rendering cover…" : draft.coverUrl ? "Regenerate cover" : "Generate cover art"}</button>{draft.coverUrl && <a className="dpm-download-cover" href={draft.coverUrl} download="book-cover.png"><Download size={14} /> Download cover</a>}</div><div className="dpm-cover-preview"><div className="dpm-cover-frame">{coverUrl ? <img src={coverUrl} alt={`Cover artwork for ${draft.title}`} /> : <div className="dpm-cover-placeholder"><BookOpen size={28} /><span>Your cover art</span><small>2:3 portrait</small></div>}</div><div className="dpm-cover-caption"><strong>{draft.title}</strong><span>{draft.subtitle || "Cover preview"}</span></div></div></section> : null}
            {tab === "read" ? <section className="dpm-reader-shell"><aside className="dpm-reader-toc"><span className="dpm-section-label">Contents</span><strong>{draft.title}</strong>{draft.chapters.map((chapter, index) => <button type="button" key={chapter.n} className="dpm-toc-item" aria-current={chapterIndex === index ? "page" : undefined} onClick={() => setChapterIndex(index)}>{String(index + 1).padStart(2, "0")}<span>{chapter.title}</span></button>)}</aside><article className="dpm-reader"><div className="dpm-reader-page">{chapterIndex === 0 && coverUrl && <img className="dpm-reader-cover" src={coverUrl} alt="" />}<span className="dpm-reader-overline">{draft.genre || "A digital book"}</span><h1>{chapterIndex === 0 ? draft.title : activeChapter?.title}</h1>{chapterIndex === 0 && draft.subtitle && <h2>{draft.subtitle}</h2>}{chapterIndex === 0 && draft.author && <p className="dpm-reader-author">{draft.author}</p>}{chapterIndex === 0 && draft.description && <p className="dpm-reader-description">{draft.description}</p>}{activeChapter ? <><h3>{activeChapter.title}</h3><div className="dpm-reader-body">{activeChapter.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></> : <p className="dpm-reader-description">Generate a manuscript to see your book in the reader.</p>}<footer><span>{String(chapterIndex + 1).padStart(2, "0")}</span><div><button type="button" disabled={chapterIndex === 0} onClick={() => setChapterIndex((value) => Math.max(0, value - 1))}><ChevronLeft size={15} /> Previous</button><button type="button" disabled={chapterIndex >= draft.chapters.length - 1} onClick={() => setChapterIndex((value) => Math.min(draft.chapters.length - 1, value + 1))}>Next <ChevronRight size={15} /></button></div></footer></div></article></section> : null}
          </>
        )}
      </section>
    </main>
  );
}
