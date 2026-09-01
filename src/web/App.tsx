import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Copy,
  FileImage,
  Film,
  FolderPlus,
  Library,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import {
  applyAgentSuggestion,
  countDefinedFields,
  createEmptyCineSpec,
  cineSpecSchema,
  qualityFieldTotal,
  type AgentSuggestion,
  type CineSpec,
  type ShotPlan,
} from "../shared/cinespec";
import { labels } from "../shared/labels";
import { Field, SelectField } from "./components/FormControls";
import { api, type Asset, type Category, type Compiled, type Health, type Run } from "./lib/api";

type Tab = "create" | "assets";

const draftStorageKey = "cinespec-studio:draft:v1";

function loadDraft() {
  try {
    const raw = window.localStorage.getItem(draftStorageKey);
    if (!raw) return createEmptyCineSpec();
    const parsed = cineSpecSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : createEmptyCineSpec();
  } catch {
    return createEmptyCineSpec();
  }
}

const shotOptions = Object.entries(labels.shotSize);
const angleOptions = Object.entries(labels.cameraAngle);
const movementOptions = Object.entries(labels.movement);
const depthOptions = Object.entries(labels.depthOfField);
const speedOptions = Object.entries(labels.motionSpeed);

const setAt = <T extends object>(source: T, path: string, value: unknown): T => {
  const clone = structuredClone(source) as Record<string, unknown>;
  const keys = path.split(".");
  let cursor = clone;
  keys.slice(0, -1).forEach((key) => { cursor = cursor[key] as Record<string, unknown>; });
  cursor[keys.at(-1)!] = value;
  return clone as T;
};

function statusLabel(status: Run["status"]) {
  return { submitting: "提交中", processing: "生成中", succeeded: "已完成", failed: "已退回" }[status];
}

function suggestionValueLabel(suggestion: AgentSuggestion) {
  const groups: Partial<Record<AgentSuggestion["path"], Record<string, string>>> = {
    "/cinematography/shotSize": labels.shotSize,
    "/cinematography/cameraAngle": labels.cameraAngle,
    "/cinematography/depthOfField": labels.depthOfField,
    "/cinematography/movement": labels.movement,
    "/cinematography/motionSpeed": labels.motionSpeed,
  };
  if (suggestion.path === "/cinematography/lensMm") return `${suggestion.value}mm`;
  return groups[suggestion.path]?.[String(suggestion.value)] || String(suggestion.value);
}

const riskLabel = { low: "低", medium: "中", high: "高" } as const;
const normalizeNegative = (value: string) => value
  .replace(/^(?:禁止|不要|避免出现[:：]?|不得|不可)/, "")
  .replace(/^不(?=循环|返回|原地|重复|人物|身份|瞬移|运动方向|肢体)/, "")
  .trim();

export function App() {
  const [tab, setTab] = useState<Tab>("create");
  const [spec, setSpec] = useState<CineSpec>(loadDraft);
  const [health, setHealth] = useState<Health | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [compiled, setCompiled] = useState<Compiled | null>(null);
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
  const [shotPlan, setShotPlan] = useState<ShotPlan | null>(null);
  const [referenceAssetId, setReferenceAssetId] = useState<string | null>(null);
  const [outputCategoryId, setOutputCategoryId] = useState<number | null>(null);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const updateSpec = <K extends string>(path: K, value: unknown) => setSpec((current) => setAt(current, path, value));

  const refreshLibrary = async () => {
    const [categoryData, assetData, runData] = await Promise.all([api.categories(), api.assets(), api.runs()]);
    setCategories(categoryData.categories);
    setAssets(assetData.assets);
    setRuns(runData.runs);
  };

  useEffect(() => {
    Promise.all([api.health(), api.categories(), api.assets(), api.runs()])
      .then(([healthData, categoryData, assetData, runData]) => {
        setHealth(healthData);
        setCategories(categoryData.categories);
        setAssets(assetData.assets);
        setRuns(runData.runs);
      })
      .catch((error) => setNotice({ tone: "error", text: error.message }));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(draftStorageKey, JSON.stringify(spec));
    const timer = window.setTimeout(() => {
      api.compile(spec).then(setCompiled).catch(() => setCompiled(null));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [spec]);

  useEffect(() => {
    if (!activeRun || activeRun.status !== "processing") return;
    const timer = window.setInterval(async () => {
      try {
        const data = await api.getRun(activeRun.id);
        setActiveRun(data.run);
        setHealth((current) => current ? { ...current, credits: data.credits } : current);
        if (data.run.status !== "processing") await refreshLibrary();
      } catch (error) {
        setNotice({ tone: "error", text: error instanceof Error ? error.message : "任务查询失败。" });
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [activeRun?.id, activeRun?.status]);

  const askAgent = async () => {
    if (!spec.brief.trim()) return setNotice({ tone: "error", text: "先写一句创作意图，Agent 才知道该补什么。" });
    if (health?.analysisMode !== "llm") return setNotice({ tone: "error", text: "LLM 尚未配置。当前请在 Codex 对话中让我通过 MCP 协作填写。" });
    setBusy("agent");
    try {
      const data = await api.suggestions(spec);
      setShotPlan(data.plan);
      setSuggestions(data.plan.suggestions);
      setNotice({ tone: "success", text: "镜头已拆为 3 段连续时间轴；确认后可应用到生成提示词。" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "分析失败。" });
    } finally { setBusy(null); }
  };

  const acceptSuggestion = (suggestion: AgentSuggestion) => {
    setSpec((current) => applyAgentSuggestion(current, suggestion));
    setSuggestions((current) => current.filter((item) => item.id !== suggestion.id));
  };

  const applyShotPlan = () => {
    if (!shotPlan) return;
    setSpec((current) => {
      const negativeItems = [
        ...(current.negativePrompt ? current.negativePrompt.split(/[，,；;]/).map(normalizeNegative).filter(Boolean) : []),
        ...shotPlan.negativeConstraints,
      ];
      return cineSpecSchema.parse({
        ...current,
        continuity: shotPlan.continuityLocks,
        timeline: shotPlan.timeline,
        negativePrompt: [...new Set(negativeItems)].join("，") || null,
      });
    });
    setNotice({ tone: "success", text: "连续性锁、0–10 秒时间轴和负面约束已写入生成提示词。" });
  };

  const createRun = async () => {
    if (!health?.wanConfigured) return setNotice({ tone: "error", text: "先在 .env 配置 DASHSCOPE_API_KEY 与业务空间 Endpoint，再启动真实生成。" });
    setBusy("generate");
    try {
      const data = await api.createRun(spec, referenceAssetId, outputCategoryId);
      setActiveRun(data.run);
      setHealth({ ...health, credits: data.credits });
      setNotice({ tone: "success", text: "任务已提交；页面会每 5 秒同步一次状态。" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "提交失败。" });
    } finally { setBusy(null); }
  };

  const defined = countDefinedFields(spec);
  const imageAssets = assets.filter((asset) => asset.mimeType.startsWith("image/"));
  const canGenerate = Boolean(health?.wanConfigured && health.credits > 0 && spec.brief.trim() &&
    (spec.mode === "text_to_video" || referenceAssetId));

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setTab("create")} aria-label="返回创作台">
          <span className="brand__mark">CS</span>
          <span><strong>CINESPEC</strong><small>CAMPUS VIDEO LAB</small></span>
        </button>
        <nav className="main-nav" aria-label="主导航">
          <button className={tab === "create" ? "is-active" : ""} onClick={() => setTab("create")}><Clapperboard size={16} />创作</button>
          <button className={tab === "assets" ? "is-active" : ""} onClick={() => setTab("assets")}><Library size={16} />素材库</button>
        </nav>
        <div className="system-strip">
          <span className={`status-dot ${health?.wanConfigured ? "is-online" : ""}`} />
          <span>{health?.wanConfigured ? health.wanModel : "仅调试模式"}</span>
          <strong>{health?.credits ?? "—"} 次</strong>
        </div>
      </header>

      {notice && (
        <div className={`notice notice--${notice.tone}`} role="status">
          {notice.tone === "error" ? <CircleAlert size={17} /> : <Check size={17} />}
          <span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="关闭"><X size={16} /></button>
        </div>
      )}

      {tab === "create" ? (
        <CreateWorkspace
          spec={spec}
          updateSpec={updateSpec}
          defined={defined}
          compiled={compiled}
          suggestions={suggestions}
          shotPlan={shotPlan}
          busy={busy}
          onAskAgent={askAgent}
          onAccept={acceptSuggestion}
          onDismiss={(id) => setSuggestions((current) => current.filter((item) => item.id !== id))}
          onApplyShotPlan={applyShotPlan}
          imageAssets={imageAssets}
          referenceAssetId={referenceAssetId}
          setReferenceAssetId={setReferenceAssetId}
          categories={categories}
          outputCategoryId={outputCategoryId}
          setOutputCategoryId={setOutputCategoryId}
          health={health}
          canGenerate={canGenerate}
          createRun={createRun}
          activeRun={activeRun}
          setTab={setTab}
        />
      ) : (
        <AssetLibrary
          categories={categories}
          assets={assets}
          runs={runs}
          refresh={refreshLibrary}
          setNotice={setNotice}
        />
      )}
    </div>
  );
}

type CreateProps = {
  spec: CineSpec;
  updateSpec: (path: string, value: unknown) => void;
  defined: number;
  compiled: Compiled | null;
  suggestions: AgentSuggestion[];
  shotPlan: ShotPlan | null;
  busy: string | null;
  onAskAgent: () => void;
  onAccept: (suggestion: AgentSuggestion) => void;
  onDismiss: (id: string) => void;
  onApplyShotPlan: () => void;
  imageAssets: Asset[];
  referenceAssetId: string | null;
  setReferenceAssetId: (id: string | null) => void;
  categories: Category[];
  outputCategoryId: number | null;
  setOutputCategoryId: (id: number | null) => void;
  health: Health | null;
  canGenerate: boolean;
  createRun: () => void;
  activeRun: Run | null;
  setTab: (tab: Tab) => void;
};

function CreateWorkspace(props: CreateProps) {
  const { spec, updateSpec } = props;
  const [advanced, setAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    if (!props.compiled) return;
    await navigator.clipboard.writeText(props.compiled.prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <main className="workspace">
      <aside className="step-rail">
        <span className="eyebrow">WORKFLOW / 01</span>
        <ol>
          <li className="is-active"><span>01</span>意图</li>
          <li><span>02</span>镜头</li>
          <li><span>03</span>校对</li>
          <li><span>04</span>生成</li>
        </ol>
        <div className="rail-note">10 SEC<br />480P<br />1 CREDIT</div>
      </aside>

      <section className="editor-column">
        <div className="page-heading">
          <div>
            <span className="eyebrow">NEW SINGLE-SHOT VIDEO</span>
            <h1>把一句想法，<br />整理成可控镜头。</h1>
          </div>
          <span className="edition">MVP<br />V0.1</span>
        </div>

        <section className="panel intent-panel">
          <div className="panel-heading"><span>01</span><h2>创作意图</h2><small>必填</small></div>
          <Field label="你想看到什么？" wide>
            <textarea
              rows={4}
              value={spec.brief}
              onChange={(event) => updateSpec("brief", event.target.value)}
              placeholder="例如：一名学生在傍晚的校园林荫道上自然地朝镜头走来，氛围安静、温暖。"
            />
          </Field>
          <div className="intent-actions">
            <div className="segmented" aria-label="生成模式">
              <button className={spec.mode === "text_to_video" ? "is-active" : ""} onClick={() => updateSpec("mode", "text_to_video")}>文字生成</button>
              <button className={spec.mode === "reference_to_video" ? "is-active" : ""} onClick={() => updateSpec("mode", "reference_to_video")}>参考图生成</button>
            </div>
            <button className="button button--blue" onClick={props.onAskAgent} disabled={props.busy === "agent" || props.health?.analysisMode !== "llm"}>
              {props.busy === "agent" ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />}
              {props.health?.analysisMode === "llm" ? "分析并补全" : "LLM 未配置"}
            </button>
          </div>
          {props.health?.analysisMode === "mcp_manual" && (
            <div className="mcp-mode"><Sparkles size={15} /><span><strong>Codex MCP 协作模式</strong>保持此页面打开，在 Codex 对话中发送“处理当前镜头”。</span></div>
          )}
        </section>

        {spec.mode === "reference_to_video" && (
          <section className="panel reference-panel">
            <div className="panel-heading"><span>REF</span><h2>人物参考图</h2><small>必选</small></div>
            {props.imageAssets.length ? (
              <div className="reference-grid">
                {props.imageAssets.map((asset) => (
                  <button
                    key={asset.id}
                    className={`reference-card ${props.referenceAssetId === asset.id ? "is-selected" : ""}`}
                    onClick={() => props.setReferenceAssetId(asset.id)}
                  >
                    <img src={asset.contentUrl} alt={asset.name} />
                    <span>{asset.name}</span>
                    {props.referenceAssetId === asset.id && <Check size={16} />}
                  </button>
                ))}
              </div>
            ) : (
              <button className="empty-reference" onClick={() => props.setTab("assets")}>
                <FileImage size={25} /><span>素材库中还没有图片</span><strong>去上传 <ArrowRight size={15} /></strong>
              </button>
            )}
          </section>
        )}

        <section className="panel">
          <div className="panel-heading"><span>02</span><h2>镜头结构</h2><small>均可选</small></div>
          <div className="field-grid">
            <Field label="主体描述"><input value={spec.subject.description ?? ""} onChange={(e) => updateSpec("subject.description", e.target.value || null)} placeholder="人物外观与身份" /></Field>
            <Field label="主体动作"><input value={spec.subject.action ?? ""} onChange={(e) => updateSpec("subject.action", e.target.value || null)} placeholder="动作如何发生" /></Field>
            <Field label="空间 / 场景"><input value={spec.scene.environment ?? ""} onChange={(e) => updateSpec("scene.environment", e.target.value || null)} placeholder="地点与空间层次" /></Field>
            <Field label="时间"><input value={spec.scene.time ?? ""} onChange={(e) => updateSpec("scene.time", e.target.value || null)} placeholder="时间与天气" /></Field>
            <SelectField label="景别" value={spec.cinematography.shotSize} onChange={(v) => updateSpec("cinematography.shotSize", v || null)} options={shotOptions} />
            <SelectField label="机位" value={spec.cinematography.cameraAngle} onChange={(v) => updateSpec("cinematography.cameraAngle", v || null)} options={angleOptions} />
            <SelectField label="焦段" value={spec.cinematography.lensMm} onChange={(v) => updateSpec("cinematography.lensMm", v ? Number(v) : null)} options={[18, 24, 35, 50, 85, 135].map((v) => [v, `${v}mm`])} />
            <SelectField label="景深" value={spec.cinematography.depthOfField} onChange={(v) => updateSpec("cinematography.depthOfField", v || null)} options={depthOptions} />
            <SelectField label="运镜" value={spec.cinematography.movement} onChange={(v) => updateSpec("cinematography.movement", v || null)} options={movementOptions} />
            <SelectField label="运动速度" value={spec.cinematography.motionSpeed} onChange={(v) => updateSpec("cinematography.motionSpeed", v || null)} options={speedOptions} />
          </div>
          <button className="text-button" onClick={() => setAdvanced(!advanced)}>{advanced ? "收起视觉与声音" : "展开视觉与声音"}<ChevronRight className={advanced ? "rotate" : ""} size={15} /></button>
          {advanced && (
            <div className="field-grid advanced-fields">
              <Field label="场景氛围"><input value={spec.scene.atmosphere ?? ""} onChange={(e) => updateSpec("scene.atmosphere", e.target.value || null)} placeholder="空间中的天气、空气与动态" /></Field>
              <Field label="风格"><input value={spec.look.style ?? ""} onChange={(e) => updateSpec("look.style", e.target.value || null)} placeholder="写实、动画、广告感…" /></Field>
              <Field label="光线"><input value={spec.look.lighting ?? ""} onChange={(e) => updateSpec("look.lighting", e.target.value || null)} placeholder="方向、软硬与曝光" /></Field>
              <Field label="色彩"><input value={spec.look.color ?? ""} onChange={(e) => updateSpec("look.color", e.target.value || null)} placeholder="主色与饱和度" /></Field>
              <Field label="情绪"><input value={spec.look.mood ?? ""} onChange={(e) => updateSpec("look.mood", e.target.value || null)} placeholder="安静、紧张、轻盈…" /></Field>
              <Field label="环境声"><input value={spec.audio.ambience ?? ""} onChange={(e) => updateSpec("audio.ambience", e.target.value || null)} placeholder="风声、人声、交通声…" /></Field>
              <Field label="负面约束"><input value={spec.negativePrompt ?? ""} onChange={(e) => updateSpec("negativePrompt", e.target.value || null)} placeholder="不希望出现的内容" /></Field>
            </div>
          )}
        </section>

        <section className="panel prompt-panel">
          <div className="panel-heading"><span>03</span><h2>生成提示词</h2><small>实时编译</small></div>
          <p className="compiled-prompt">{props.compiled?.prompt || "正在编译…"}</p>
          {props.compiled?.warnings.map((warning) => <p className="warning" key={warning}><CircleAlert size={14} />{warning}</p>)}
          <button className="copy-button" onClick={copyPrompt}><Copy size={14} />{copied ? "已复制" : "复制提示词"}</button>
        </section>
      </section>

      <aside className="inspector">
        <section className="score-card">
          <span className="eyebrow">DEFINED SHOT FIELDS</span>
          <div className="score"><strong>{String(props.defined).padStart(2, "0")}</strong><span>/ {qualityFieldTotal}</span></div>
          <div className="score-track"><i style={{ width: `${(props.defined / qualityFieldTotal) * 100}%` }} /></div>
          <p>不追求填满。只保留真正影响画面的字段。</p>
        </section>

        <section className="agent-card">
          <div className="aside-title"><Sparkles size={16} /><strong>镜头分析</strong><span>{props.shotPlan?.timeline.length ?? props.suggestions.length}</span></div>
          {props.shotPlan && (
            <div className="shot-plan">
              <div className="plan-risks">
                <div><span>循环风险</span><strong data-level={props.shotPlan.loopRisk.level}>{riskLabel[props.shotPlan.loopRisk.level]}</strong></div>
                <div><span>执行复杂度</span><strong data-level={props.shotPlan.complexity.level}>{riskLabel[props.shotPlan.complexity.level]}</strong></div>
              </div>
              <p className="plan-summary">{props.shotPlan.intentSummary}</p>
              <ol className="plan-timeline">
                {props.shotPlan.timeline.map((beat) => (
                  <li key={`${beat.start}-${beat.end}`}>
                    <b>{beat.start}–{beat.end}S</b>
                    <div><strong>{beat.subjectAction}</strong><span>镜头：{beat.cameraAction}</span><small>段末：{beat.endState}</small></div>
                  </li>
                ))}
              </ol>
              {props.shotPlan.warnings.length > 0 && (
                <ul className="plan-warnings">{props.shotPlan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              )}
              <button className="plan-apply" onClick={props.onApplyShotPlan}><Check size={14} />应用连续性计划</button>
            </div>
          )}
          {props.suggestions.length ? props.suggestions.map((suggestion) => (
            <article className="suggestion" key={suggestion.id}>
              <header><strong>{suggestion.label}</strong><span>{Math.round(suggestion.confidence * 100)}%</span></header>
              <p>{suggestionValueLabel(suggestion)}</p>
              <small>{suggestion.reason}</small>
              <div><button onClick={() => props.onAccept(suggestion)}><Check size={14} />接受</button><button onClick={() => props.onDismiss(suggestion.id)}><X size={14} />忽略</button></div>
            </article>
          )) : !props.shotPlan && <p className="aside-empty">{props.health?.analysisMode === "llm" ? "填写创作意图后，让 LLM 规划连续时间轴，并只补全缺失字段。它不会覆盖你的选择。" : "当前由 Codex MCP 协作填写；站点不会运行规则 Demo 或伪造分析结果。"}</p>}
        </section>

        <section className="dispatch-card">
          <div className="dispatch-row"><span>模型</span><strong>{props.health?.wanModel || "读取中"}</strong></div>
          <div className="dispatch-row"><span>规格</span><strong>480P · 10S</strong></div>
          <label className="dispatch-select">生成后归档
            <select value={props.outputCategoryId ?? ""} onChange={(e) => props.setOutputCategoryId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">未分类</option>
              {props.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
            </select>
          </label>
          {!props.health?.wanConfigured && <p className="config-hint">Wan 密钥或业务空间 Endpoint 未配置。真实生成已锁定，不会扣除次数。</p>}
          {props.health?.analysisMode === "mcp_manual" && <p className="config-hint">LLM 未配置。镜头结构暂由 Codex MCP 协作填写。</p>}
          <button className="generate-button" disabled={!props.canGenerate || props.busy === "generate"} onClick={props.createRun}>
            {props.busy === "generate" ? <LoaderCircle className="spin" size={18} /> : <Film size={18} />}
            生成视频
            <span>1 次</span>
          </button>
          <small className="balance">剩余 {props.health?.credits ?? "—"} 次</small>
        </section>

        {props.activeRun && (
          <section className={`run-card run-card--${props.activeRun.status}`}>
            <span>LAST RUN</span><strong>{statusLabel(props.activeRun.status)}</strong>
            <small>{props.activeRun.id.slice(0, 8)}</small>
            {props.activeRun.error && <p>{props.activeRun.error}</p>}
            {props.activeRun.outputAssetId && <a href={`/api/assets/${props.activeRun.outputAssetId}/content`} target="_blank">打开视频 <ArrowRight size={14} /></a>}
          </section>
        )}
      </aside>
    </main>
  );
}

function AssetLibrary({
  categories,
  assets,
  runs,
  refresh,
  setNotice,
}: {
  categories: Category[];
  assets: Asset[];
  runs: Run[];
  refresh: () => Promise<void>;
  setNotice: (notice: { tone: "error" | "success"; text: string } | null) => void;
}) {
  const [filter, setFilter] = useState<number | "all">("all");
  const [newCategory, setNewCategory] = useState("");
  const [uploadCategory, setUploadCategory] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const shownAssets = useMemo(() => filter === "all" ? assets : assets.filter((asset) => asset.categoryId === filter), [assets, filter]);
  const addCategory = async () => {
    if (!newCategory.trim()) return;
    try {
      await api.createCategory(newCategory);
      setNewCategory("");
      await refresh();
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "创建失败。" }); }
  };
  const deleteCategory = async (id: number) => {
    try {
      await api.deleteCategory(id);
      if (filter === id) setFilter("all");
      await refresh();
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "删除失败。" }); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      await api.uploadAsset(file, uploadCategory);
      await refresh();
      setNotice({ tone: "success", text: `${file.name} 已加入素材库。` });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "上传失败。" }); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  return (
    <main className="library-page">
      <header className="library-heading">
        <div><span className="eyebrow">PERSONAL ASSET DESK</span><h1>素材由用户<br />自己组织。</h1></div>
        <div className="library-count"><strong>{String(assets.length).padStart(2, "0")}</strong><span>ASSETS</span></div>
      </header>
      <div className="library-layout">
        <aside className="category-panel">
          <div className="aside-title"><Library size={16} /><strong>分类</strong></div>
          <button className={`category-item ${filter === "all" ? "is-active" : ""}`} onClick={() => setFilter("all")}><span>全部素材</span><b>{assets.length}</b></button>
          {categories.map((category) => (
            <div className={`category-item ${filter === category.id ? "is-active" : ""}`} key={category.id}>
              <button onClick={() => setFilter(category.id)}><span>{category.name}</span><b>{assets.filter((asset) => asset.categoryId === category.id).length}</b></button>
              <button className="category-delete" onClick={() => deleteCategory(category.id)} aria-label={`删除 ${category.name}`}><Trash2 size={13} /></button>
            </div>
          ))}
          <div className="new-category">
            <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCategory()} placeholder="新分类名称" maxLength={30} />
            <button onClick={addCategory} aria-label="创建分类"><FolderPlus size={16} /></button>
          </div>
        </aside>

        <section className="asset-main">
          <div className="asset-toolbar">
            <div><strong>{filter === "all" ? "全部素材" : categories.find((category) => category.id === filter)?.name}</strong><span>{shownAssets.length} ITEMS</span></div>
            <div className="upload-controls">
              <select value={uploadCategory ?? ""} onChange={(e) => setUploadCategory(e.target.value ? Number(e.target.value) : null)} aria-label="上传分类">
                <option value="">未分类</option>
                {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
              </select>
              <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
              <button className="button button--blue" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}上传素材
              </button>
            </div>
          </div>
          {shownAssets.length ? (
            <div className="asset-grid">
              {shownAssets.map((asset, index) => (
                <article className="asset-card" key={asset.id}>
                  <a href={asset.contentUrl} target="_blank" className="asset-preview">
                    {asset.mimeType.startsWith("image/") ? <img src={asset.contentUrl} alt={asset.name} /> : <video src={asset.contentUrl} muted preload="metadata" />}
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </a>
                  <div><strong title={asset.name}>{asset.name}</strong><small>{asset.source === "generated" ? "AI 生成" : "用户上传"} · {new Date(asset.createdAt).toLocaleDateString("zh-CN")}</small></div>
                </article>
              ))}
            </div>
          ) : (
            <button className="asset-empty" onClick={() => fileRef.current?.click()}>
              <Plus size={28} /><strong>添加第一份素材</strong><span>支持图片与视频，单文件不超过 30MB。</span>
            </button>
          )}
          {runs.length > 0 && (
            <section className="run-history">
              <div className="panel-heading"><span>LOG</span><h2>最近生成</h2><small>{runs.length}</small></div>
              {runs.slice(0, 5).map((run) => <div className="history-row" key={run.id}><span>{run.id.slice(0, 8)}</span><strong>{statusLabel(run.status)}</strong><time>{new Date(run.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></div>)}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
