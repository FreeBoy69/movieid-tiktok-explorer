"""
Patches MovieAnalysisTabs.tsx to add a hideTabs prop that skips the inner tab bar
and outer card wrapper when the parent already renders tabs in the page header.
"""
import re, sys

path = r"src\components\MovieAnalysisTabs.tsx"
with open(path, encoding="utf-8") as f:
    src = f.read()

# 1. Add hideTabs to the function signature (after compact = false,)
src = src.replace(
    '  compact = false,\n  postContent,',
    '  compact = false,\n  hideTabs = false,\n  postContent,'
)
src = src.replace(
    '  compact?: boolean;\n  postContent?: ReactNode;',
    '  compact?: boolean;\n  hideTabs?: boolean;\n  postContent?: ReactNode;'
)

# 2. Change all setActiveTab calls in the return block to use handleTabChange
# First add handleTabChange after the useState line
src = src.replace(
    "  const [activeTab, setActiveTab] = useState<MainTab>(initialTab || (postContent ? \"post\" : \"movie\"));\n",
    "  const [activeTab, setActiveTab] = useState<MainTab>(initialTab || (postContent ? \"post\" : \"movie\"));\n  const handleTabChange = (tab: MainTab) => setActiveTab(tab);\n"
)

# 3. Add hideTabs guard before the existing return (
# Find the "  return (" and inject the early return before it
old_return_start = "  return (\n    <div className=\"w-full max-w-full overflow-hidden rounded-xl border shadow-sm\""

new_early_return = '''  if (hideTabs) {
    return (
      <div className="w-full max-w-full overflow-x-hidden px-4 py-4 md:px-5 md:py-5">
        {activeTab === "post" && postContent}
        {activeTab === "movie" && <MovieTab result={result} savedAt={savedAt} onRewrite={rewrite} />}
        {activeTab === "transcript" && (
          <TabbedPage nav={[["copy", "Transcript"], ["hooks", "Hooks"], ["style", "Content notes"]]}>
            <Panel id="copy" title="Transcript" action={<SmallAction onClick={rewrite}>Rewrite</SmallAction>}>
              <TextBlock text={transcriptText || "No transcript was returned for this clip."} />
            </Panel>
            <Panel id="hooks" title="Hooks">
              <ListPanel items={transcript?.hooks} fallback={["No hooks were returned for this clip."]} />
            </Panel>
            <Panel id="style" title="Content notes">
              <div className="grid gap-3 md:grid-cols-2">
                <ListPanel title="Content style" items={transcript?.contentStyle} fallback={["No content style notes were returned."]} />
                <ListPanel title="Structure" items={transcript?.structure} fallback={["No structure notes were returned."]} />
              </div>
            </Panel>
          </TabbedPage>
        )}
        {activeTab === "story" && <StoryTab result={result} />}
        {activeTab === "visuals" && <VisualsTab result={result} />}
        {activeTab === "niche" && <NicheTab result={result} />}
        {activeTab === "evidence" && <EvidenceTab result={result} />}
        {activeTab === "details" && <DetailsTab result={result} />}
      </div>
    );
  }

'''

if old_return_start in src:
    src = src.replace(old_return_start, new_early_return + "  return (\n    <div className=\"w-full max-w-full overflow-hidden rounded-xl border shadow-sm\"", 1)
    print("hideTabs guard injected OK")
else:
    print("ERROR: could not find return block to patch", file=sys.stderr)
    sys.exit(1)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)

print("Patch complete.")
