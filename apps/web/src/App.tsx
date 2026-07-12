import {
  Activity,
  Braces,
  ChevronRight,
  CircleHelp,
  Database,
  FileDown,
  Globe2,
  KeyRound,
  Layers3,
  ListTree,
  LogOut,
  Menu,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, formatApiError, newIdempotencyKey } from "./api";
import type {
  ApiKeyRecord,
  Capability,
  Health,
  Operation,
  OperationList,
} from "./types";

type View = "overview" | "operations" | Capability | "keys" | "system";
type Notice = { tone: "success" | "error"; message: string } | null;

const nav: Array<{
  id: View;
  label: string;
  icon: typeof Activity;
  group: string;
}> = [
  { id: "overview", label: "Overview", icon: Activity, group: "Workspace" },
  { id: "operations", label: "Operations", icon: ListTree, group: "Workspace" },
  { id: "fetch", label: "Fetch", icon: Globe2, group: "Capabilities" },
  { id: "survey", label: "Survey", icon: Network, group: "Capabilities" },
  { id: "collect", label: "Collection", icon: Layers3, group: "Capabilities" },
  { id: "search", label: "Search", icon: Search, group: "Capabilities" },
  { id: "shape", label: "Shape", icon: Braces, group: "Capabilities" },
  { id: "keys", label: "API keys", icon: KeyRound, group: "Manage" },
  { id: "system", label: "System", icon: ServerCog, group: "Manage" },
];

const titles: Record<
  View,
  { eyebrow: string; title: string; description: string }
> = {
  overview: {
    eyebrow: "Operations console",
    title: "Your web data, in motion",
    description:
      "Launch, observe, and manage every Stratafetch workload from one place.",
  },
  operations: {
    eyebrow: "Activity",
    title: "Operations",
    description:
      "Follow active work and inspect the provenance of completed results.",
  },
  fetch: {
    eyebrow: "Capability",
    title: "Fetch a page",
    description: "Retrieve one HTML or PDF resource with the outputs you need.",
  },
  survey: {
    eyebrow: "Capability",
    title: "Survey a site",
    description:
      "Discover a bounded inventory of URLs before collecting content.",
  },
  collect: {
    eyebrow: "Capability",
    title: "Create a collection",
    description: "Retrieve pages from a survey or an explicit list of URLs.",
  },
  search: {
    eyebrow: "Brave Search",
    title: "Search the web",
    description: "Return ranked URL metadata without fetching result pages.",
  },
  shape: {
    eyebrow: "OpenAI",
    title: "Shape content",
    description:
      "Transform stored or inline content into validated structured data.",
  },
  keys: {
    eyebrow: "Access control",
    title: "API keys",
    description:
      "Issue narrowly scoped credentials and revoke access immediately.",
  },
  system: {
    eyebrow: "Self-hosted runtime",
    title: "System health",
    description:
      "Check dependencies, providers, version, and retention policy.",
  },
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`status status--${status}`}>
      <span aria-hidden="true" />
      {status}
    </span>
  );
}

function EmptyState({
  icon: Icon = ListTree,
  title,
  children,
}: {
  icon?: typeof Activity;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon size={22} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/v1/admin/session", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setToken("");
      onLogin();
    } catch (reason) {
      setError(formatApiError(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <div className="login-contours" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand brand--large">
          <span className="brand__mark">
            <i />
            <i />
            <i />
          </span>
          <span>STRATAFETCH</span>
        </div>
        <p className="eyebrow">Operations console</p>
        <h1 id="login-title">Enter the control layer.</h1>
        <p className="login-copy">
          Use the administrator token configured on this Stratafetch server. It
          is exchanged for a secure session and never stored in this browser.
        </p>
        <form onSubmit={submit} className="form-stack">
          <input
            className="sr-only"
            type="text"
            name="username"
            value="administrator"
            autoComplete="username"
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
          <label>
            Administrator token
            <input
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              autoFocus
              placeholder="Enter STRATAFETCH_ADMIN_TOKEN"
            />
          </label>
          {error && (
            <div className="notice notice--error" role="alert">
              {error}
            </div>
          )}
          <button
            className="button button--primary button--wide"
            disabled={busy || !token}
          >
            {busy ? (
              <RefreshCw className="spin" size={16} />
            ) : (
              <ShieldCheck size={17} />
            )}
            {busy ? "Authenticating…" : "Open console"}
          </button>
        </form>
        <p className="login-note">
          <ShieldCheck size={15} /> Your provider credentials stay server-side.
        </p>
      </section>
    </main>
  );
}

function OperationTable({
  operations,
  onSelect,
}: {
  operations: Operation[];
  onSelect: (operation: Operation) => void;
}) {
  if (!operations.length)
    return (
      <EmptyState title="No operations yet">
        Launch Fetch, Survey, Collection, Search, or Shape to see it here.
      </EmptyState>
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Operation</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Started</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {operations.map((op) => {
            const progress = op.progress?.total
              ? Math.round((op.progress.current / op.progress.total) * 100)
              : op.status === "completed"
                ? 100
                : 0;
            return (
              <tr
                key={op.id}
                onClick={() => onSelect(op)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(op);
                }}
              >
                <td>
                  <span className="op-type">{op.type}</span>
                  <code>{op.id.slice(0, 8)}</code>
                </td>
                <td>
                  <StatusPill status={op.status} />
                </td>
                <td>
                  <div className="progress-cell">
                    <div
                      className="progress"
                      aria-label={`${progress}% complete`}
                    >
                      <i style={{ width: `${progress}%` }} />
                    </div>
                    <span>{progress}%</span>
                  </div>
                </td>
                <td>
                  <time dateTime={op.createdAt}>
                    {new Date(op.createdAt).toLocaleString()}
                  </time>
                </td>
                <td>
                  <ChevronRight size={17} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function RunPanel({
  title,
  description,
  children,
  onSubmit,
  busy,
  action = "Run operation",
}: {
  title: string;
  description: string;
  children: ReactNode;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  action?: string;
}) {
  return (
    <section className="run-grid">
      <form className="panel form-panel" onSubmit={onSubmit}>
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <div className="capability-glyph" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
        {children}
        <button className="button button--primary" disabled={busy}>
          {busy ? <RefreshCw className="spin" size={16} /> : <Play size={16} />}
          {busy ? "Submitting…" : action}
        </button>
      </form>
      <aside className="panel guidance">
        <CircleHelp size={20} />
        <div>
          <h3>Good to know</h3>
          <p>
            Requests use an idempotency key. Retrying this submission will not
            create duplicate work.
          </p>
        </div>
      </aside>
    </section>
  );
}

function CapabilityView({
  type,
  onCreated,
  setNotice,
}: {
  type: Capability;
  onCreated: (operation?: Operation) => void;
  setNotice: (notice: Notice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const submit =
    (path: string, payload: Record<string, unknown>) =>
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setNotice(null);
      try {
        await api(path, {
          method: "POST",
          headers: { "Idempotency-Key": newIdempotencyKey() },
          body: JSON.stringify(payload),
        });
        setNotice({
          tone: "success",
          message: `${type[0].toUpperCase()}${type.slice(1)} operation started successfully.`,
        });
        onCreated();
      } catch (error) {
        setNotice({ tone: "error", message: formatApiError(error) });
      } finally {
        setBusy(false);
      }
    };

  if (type === "fetch") return <FetchForm busy={busy} submit={submit} />;
  if (type === "survey") return <SurveyForm busy={busy} submit={submit} />;
  if (type === "collect") return <CollectionForm busy={busy} submit={submit} />;
  if (type === "search") return <SearchForm busy={busy} submit={submit} />;
  return <ShapeForm busy={busy} submit={submit} />;
}

type Submitter = (
  path: string,
  payload: Record<string, unknown>,
) => (event: FormEvent<HTMLFormElement>) => void;

function FetchForm({ busy, submit }: { busy: boolean; submit: Submitter }) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState("http");
  const [outputs, setOutputs] = useState(["markdown"]);
  const toggle = (value: string) =>
    setOutputs((current) =>
      current.includes(value)
        ? current.filter((x) => x !== value)
        : [...current, value],
    );
  return (
    <RunPanel
      title="Page request"
      description="Retrieve a single public URL and retain its operation history."
      busy={busy}
      onSubmit={submit("/v1/fetch", { url, mode, outputs })}
      action="Fetch page"
    >
      <Field label="URL">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.org/article"
          required
        />
      </Field>
      <div className="field-row">
        <Field label="Retrieval mode">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="http">HTTP — fastest</option>
            <option value="browser">Browser — rendered</option>
          </select>
        </Field>
        <fieldset>
          <legend>Outputs</legend>
          <div className="checks">
            {["markdown", "text", "html", "links"].map((item) => (
              <label key={item}>
                <input
                  type="checkbox"
                  checked={outputs.includes(item)}
                  onChange={() => toggle(item)}
                />
                {item}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </RunPanel>
  );
}

function SurveyForm({ busy, submit }: { busy: boolean; submit: Submitter }) {
  const [rootUrl, setRootUrl] = useState("");
  const [depth, setDepth] = useState(2);
  const [maxUrls, setMaxUrls] = useState(500);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [subdomains, setSubdomains] = useState(false);
  const [mode, setMode] = useState("http");
  return (
    <RunPanel
      title="Discovery boundary"
      description="Use sitemaps and bounded link traversal to map a site."
      busy={busy}
      onSubmit={submit("/v1/surveys", {
        startUrl: rootUrl,
        maxDepth: depth,
        maxUrls,
        include: include ? [include] : [],
        exclude: exclude ? [exclude] : [],
        includeSubdomains: subdomains,
        mode,
        robotsPolicy: "respect",
      })}
      action="Start survey"
    >
      <Field label="Root URL">
        <input
          type="url"
          value={rootUrl}
          onChange={(e) => setRootUrl(e.target.value)}
          required
          placeholder="https://docs.example.org"
        />
      </Field>
      <div className="field-row">
        <Field label="Maximum depth">
          <input
            type="number"
            min="0"
            max="20"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          />
        </Field>
        <Field label="Maximum URLs" hint="Up to 10,000">
          <input
            type="number"
            min="1"
            max="10000"
            value={maxUrls}
            onChange={(e) => setMaxUrls(Number(e.target.value))}
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Include pattern" hint="Optional glob">
          <input
            value={include}
            onChange={(e) => setInclude(e.target.value)}
            placeholder="/docs/**"
          />
        </Field>
        <Field label="Exclude pattern" hint="Optional glob">
          <input
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
            placeholder="/archive/**"
          />
        </Field>
      </div>
      <Field label="Traversal mode">
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="http">HTTP — fastest</option>
          <option value="browser">Browser — rendered</option>
        </select>
      </Field>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={subdomains}
          onChange={(e) => setSubdomains(e.target.checked)}
        />
        <span>
          <b>Include subdomains</b>
          <small>Allow discovery outside the root hostname.</small>
        </span>
      </label>
    </RunPanel>
  );
}

function CollectionForm({
  busy,
  submit,
}: {
  busy: boolean;
  submit: Submitter;
}) {
  const [source, setSource] = useState("survey");
  const [surveyId, setSurveyId] = useState("");
  const [urls, setUrls] = useState("");
  const [mode, setMode] = useState("http");
  const payload =
    source === "survey"
      ? {
          source: { type: "survey", surveyId },
          mode,
          outputs: ["markdown", "text"],
          robotsPolicy: "respect",
        }
      : {
          source: {
            type: "urls",
            urls: urls
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
          },
          mode,
          outputs: ["markdown", "text"],
          robotsPolicy: "respect",
        };
  return (
    <RunPanel
      title="Collection source"
      description="Retrieve content from one existing survey or a fixed URL list."
      busy={busy}
      onSubmit={submit("/v1/collections", payload)}
      action="Create collection"
    >
      <fieldset>
        <legend>Source</legend>
        <div className="segmented">
          <label>
            <input
              type="radio"
              name="source"
              value="survey"
              checked={source === "survey"}
              onChange={() => setSource("survey")}
            />
            <span>Survey ID</span>
          </label>
          <label>
            <input
              type="radio"
              name="source"
              value="urls"
              checked={source === "urls"}
              onChange={() => setSource("urls")}
            />
            <span>URL list</span>
          </label>
        </div>
      </fieldset>
      {source === "survey" ? (
        <Field label="Survey ID">
          <input
            value={surveyId}
            onChange={(e) => setSurveyId(e.target.value)}
            required
            placeholder="sur_…"
          />
        </Field>
      ) : (
        <Field label="URLs" hint="One URL per line, up to 1,000">
          <textarea
            rows={7}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            required
            placeholder={
              "https://example.org/page-one\nhttps://example.org/page-two"
            }
          />
        </Field>
      )}
      <Field label="Retrieval mode">
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="http">HTTP — fastest</option>
          <option value="browser">Browser — rendered</option>
        </select>
      </Field>
    </RunPanel>
  );
}

function SearchForm({ busy, submit }: { busy: boolean; submit: Submitter }) {
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(10);
  const [country, setCountry] = useState("US");
  return (
    <RunPanel
      title="Search query"
      description="Use Brave Search to return ranked URL metadata only."
      busy={busy}
      onSubmit={submit("/v1/search", { query, limit: count, country })}
      action="Search web"
    >
      <Field label="Query">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          required
          placeholder="open source web data infrastructure"
        />
      </Field>
      <div className="field-row">
        <Field label="Result count">
          <input
            type="number"
            min="1"
            max="20"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </Field>
        <Field label="Country">
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option>US</option>
            <option>CA</option>
            <option>GB</option>
            <option>AU</option>
            <option>DE</option>
          </select>
        </Field>
      </div>
    </RunPanel>
  );
}

function ShapeForm({ busy, submit }: { busy: boolean; submit: Submitter }) {
  const [sourceType, setSourceType] = useState("fetch");
  const [sourceId, setSourceId] = useState("");
  const [inlineContent, setInlineContent] = useState("");
  const [instruction, setInstruction] = useState("");
  const [schema, setSchema] = useState(
    '{\n  "type": "object",\n  "properties": {}\n}',
  );
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(schema);
  } catch {
    parsed = schema;
  }
  const source =
    sourceType === "fetch"
      ? { type: "fetch", fetchId: sourceId }
      : sourceType === "collection"
        ? { type: "collection", collectionId: sourceId }
        : { type: "inline", content: inlineContent };
  return (
    <RunPanel
      title="Structured transformation"
      description="Transform content with OpenAI and validate against JSON Schema 2020-12."
      busy={busy}
      onSubmit={submit("/v1/shapes", {
        source,
        instructions: instruction,
        schema: parsed,
      })}
      action="Shape content"
    >
      <div className="field-row">
        <Field label="Source type">
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
          >
            <option value="fetch">Fetch</option>
            <option value="collection">Collection</option>
            <option value="inline">Inline content</option>
          </select>
        </Field>
        {sourceType !== "inline" && (
          <Field label="Source ID">
            <input
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              required
              placeholder="Operation or collection ID"
            />
          </Field>
        )}
      </div>
      {sourceType === "inline" && (
        <Field label="Inline content" hint="Up to 2 MB">
          <textarea
            rows={6}
            value={inlineContent}
            onChange={(e) => setInlineContent(e.target.value)}
            required
            placeholder="Paste bounded source content here…"
          />
        </Field>
      )}
      <Field label="Instruction">
        <textarea
          rows={3}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          required
          placeholder="Extract the article title, author, and publication date."
        />
      </Field>
      <Field label="Output schema">
        <textarea
          className="code-input"
          rows={8}
          spellCheck="false"
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
          required
        />
      </Field>
    </RunPanel>
  );
}

function Overview({
  operations,
  health,
  onNavigate,
  onSelect,
}: {
  operations: Operation[];
  health: Health | null;
  onNavigate: (view: View) => void;
  onSelect: (operation: Operation) => void;
}) {
  const active = operations.filter(
    (op) => op.status === "running" || op.status === "queued",
  ).length;
  const successful = operations.filter(
    (op) => op.status === "completed",
  ).length;
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Stratafetch 1.0</p>
          <h2>
            Turn the open web into
            <br />
            <em>usable layers.</em>
          </h2>
          <p>
            Discover sources, retrieve content, and shape reliable structured
            data—all inside your own infrastructure.
          </p>
        </div>
        <div className="hero-rings" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </section>
      <div className="stats">
        <article>
          <span>Active now</span>
          <strong>{active}</strong>
          <small>queued or running</small>
        </article>
        <article>
          <span>Completed</span>
          <strong>{successful}</strong>
          <small>in this view</small>
        </article>
        <article>
          <span>Content retention</span>
          <strong>
            {health?.retentionDays ?? 30}
            <sup> days</sup>
          </strong>
          <small>metadata retained</small>
        </article>
        <article>
          <span>System</span>
          <strong className="health-word">{health?.status ?? "unknown"}</strong>
          <small>
            {health?.version ? `version ${health.version}` : "health pending"}
          </small>
        </article>
      </div>
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Start a workflow</p>
            <h2>Choose a capability</h2>
          </div>
        </div>
        <div className="cap-grid">
          {nav
            .filter((item) => item.group === "Capabilities")
            .map(({ id, label, icon: Icon }, index) => (
              <button key={id} onClick={() => onNavigate(id)}>
                <span className={`cap-num cap-num--${index}`}>
                  0{index + 1}
                </span>
                <Icon size={22} />
                <strong>{label}</strong>
                <p>{titles[id].description}</p>
                <ChevronRight size={18} />
              </button>
            ))}
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Live activity</p>
            <h2>Recent operations</h2>
          </div>
          <button
            className="button button--quiet"
            onClick={() => onNavigate("operations")}
          >
            View all <ChevronRight size={15} />
          </button>
        </div>
        <div className="panel">
          <OperationTable
            operations={operations.slice(0, 5)}
            onSelect={onSelect}
          />
        </div>
      </section>
    </>
  );
}

function OperationsView({
  operations,
  loading,
  refresh,
  loadMore,
  hasMore,
  onSelect,
}: {
  operations: Operation[];
  loading: boolean;
  refresh: () => void;
  loadMore: () => void;
  hasMore: boolean;
  onSelect: (operation: Operation) => void;
}) {
  const [filter, setFilter] = useState("all");
  const visible =
    filter === "all"
      ? operations
      : operations.filter((op) => op.status === filter || op.type === filter);
  return (
    <section className="panel">
      <div className="toolbar">
        <div
          className="filter-tabs"
          role="group"
          aria-label="Filter operations"
        >
          {[
            "all",
            "running",
            "failed",
            "fetch",
            "survey",
            "collection",
            "search",
            "shape",
          ].map((item) => (
            <button
              className={filter === item ? "active" : ""}
              key={item}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          className="icon-button"
          aria-label="Refresh operations"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw size={17} className={loading ? "spin" : ""} />
        </button>
      </div>
      <OperationTable operations={visible} onSelect={onSelect} />
      {hasMore && (
        <div className="load-more">
          <button className="button" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Load older operations"}
          </button>
        </div>
      )}
    </section>
  );
}

function KeysView({ setNotice }: { setNotice: (notice: Notice) => void }) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [revealed, setRevealed] = useState("");
  const load = useCallback(async () => {
    try {
      const value = await api<{ data: ApiKeyRecord[] }>("/v1/admin/keys");
      setKeys(value.data);
    } catch (e) {
      setNotice({ tone: "error", message: formatApiError(e) });
    } finally {
      setLoading(false);
    }
  }, [setNotice]);
  useEffect(() => {
    void load();
  }, [load]);
  async function revoke(id: string) {
    if (
      !window.confirm(
        "Revoke this API key? Requests using it will stop immediately.",
      )
    )
      return;
    try {
      await api(`/v1/admin/keys/${id}`, { method: "DELETE" });
      await load();
      setNotice({ tone: "success", message: "API key revoked." });
    } catch (e) {
      setNotice({ tone: "error", message: formatApiError(e) });
    }
  }
  return (
    <>
      <div className="section-heading">
        <p>
          {loading
            ? "Loading credentials…"
            : `${keys.filter((key) => !key.revokedAt).length} active credentials`}
        </p>
        <button
          className="button button--primary"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={16} />
          Create API key
        </button>
      </div>
      {revealed && (
        <div className="secret-callout" role="status">
          <div>
            <strong>Copy this key now</strong>
            <p>It will not be shown again.</p>
          </div>
          <code>{revealed}</code>
          <button
            className="button"
            onClick={() => void navigator.clipboard.writeText(revealed)}
          >
            Copy
          </button>
        </div>
      )}
      <section className="panel">
        {keys.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scopes</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td>
                      <strong>{key.name}</strong>
                      <br />
                      <code>{key.prefix ?? key.id.slice(0, 8)}…</code>
                    </td>
                    <td>
                      <div className="scope-list">
                        {key.scopes.map((scope) => (
                          <span key={scope}>{scope}</span>
                        ))}
                      </div>
                    </td>
                    <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                    <td>
                      {key.lastUsedAt
                        ? new Date(key.lastUsedAt).toLocaleString()
                        : "Never"}
                    </td>
                    <td>
                      <button
                        className="icon-button danger"
                        onClick={() => void revoke(key.id)}
                        aria-label={`Revoke ${key.name}`}
                        disabled={Boolean(key.revokedAt)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && (
            <EmptyState icon={KeyRound} title="No API keys">
              Create a scoped key for CLI or API access.
            </EmptyState>
          )
        )}
      </section>
      {showCreate && (
        <KeyDialog
          onClose={() => setShowCreate(false)}
          onCreated={(secret) => {
            setRevealed(secret);
            setShowCreate(false);
            void load();
          }}
        />
      )}
    </>
  );
}

function KeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(["fetch"]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (scope: string) =>
    setScopes((items) =>
      items.includes(scope)
        ? items.filter((x) => x !== scope)
        : [...items, scope],
    );
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const value = await api<{ data: { secret: string } }>("/v1/admin/keys", {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify({ name, scopes }),
      });
      onCreated(value.data.secret);
    } catch (reason) {
      setError(formatApiError(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-title"
      >
        <button className="dialog-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <p className="eyebrow">Access control</p>
        <h2 id="key-title">Create an API key</h2>
        <form onSubmit={create} className="form-stack">
          <Field label="Key name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              placeholder="Production collector"
            />
          </Field>
          <fieldset>
            <legend>Scopes</legend>
            <div className="checks checks--stacked">
              {["fetch", "survey", "collect", "search", "shape", "admin"].map(
                (scope) => (
                  <label key={scope}>
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={() => toggle(scope)}
                    />
                    {scope}
                  </label>
                ),
              )}
            </div>
          </fieldset>
          {error && <div className="notice notice--error">{error}</div>}
          <button
            className="button button--primary"
            disabled={busy || !scopes.length}
          >
            {busy ? "Creating…" : "Create key"}
          </button>
        </form>
      </div>
    </div>
  );
}

function SystemView({
  health,
  refresh,
}: {
  health: Health | null;
  refresh: () => void;
}) {
  const services = health?.services ?? {
    postgresql: "unavailable",
    redis: "unavailable",
    egress: "unavailable",
  };
  const providers = health?.providers ?? { brave: false, openai: false };
  return (
    <>
      <div className="system-banner">
        <div
          className={`system-orb system-orb--${health?.status ?? "unavailable"}`}
        >
          <Activity />
        </div>
        <div>
          <p className="eyebrow">Overall status</p>
          <h2>
            {health?.status === "ok"
              ? "All systems operational"
              : health?.status === "degraded"
                ? "Some services need attention"
                : "Health status unavailable"}
          </h2>
          <p>
            {health?.version
              ? `Stratafetch ${health.version}`
              : "Connect to the API to retrieve runtime health."}
          </p>
        </div>
        <button className="button" onClick={refresh}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      <div className="system-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Infrastructure</p>
              <h2>Core services</h2>
            </div>
            <Database />
          </div>
          {Object.entries(services).map(([name, status]) => (
            <div className="health-row" key={name}>
              <span>{name}</span>
              <StatusPill status={status} />
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">External</p>
              <h2>Providers</h2>
            </div>
            <Globe2 />
          </div>
          {Object.entries(providers).map(([name, configured]) => (
            <div className="health-row" key={name}>
              <span>{name}</span>
              <span className={configured ? "configured" : "missing"}>
                {configured ? "Configured" : "Not configured"}
              </span>
            </div>
          ))}
          <p className="panel-note">
            Secrets are read from the server environment and are never sent to
            this console.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Lifecycle</p>
              <h2>Retention</h2>
            </div>
            <FileDown />
          </div>
          <div className="retention-value">
            {health?.retentionDays ?? 30}
            <span>days</span>
          </div>
          <p>
            Stored page content expires automatically. Operation metadata is
            retained until you delete it.
          </p>
        </section>
      </div>
    </>
  );
}

function OperationDrawer({
  operation,
  onClose,
  onChanged,
}: {
  operation: Operation;
  onClose: () => void;
  onChanged: () => void;
}) {
  const active =
    operation.status === "running" || operation.status === "queued";
  async function action(method: "POST" | "DELETE") {
    if (
      method === "DELETE" &&
      !window.confirm("Delete this operation and its stored results?")
    )
      return;
    await api(
      `/v1/operations/${operation.id}${method === "POST" ? "/cancel" : ""}`,
      { method },
    );
    onChanged();
    onClose();
  }
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="drawer" aria-label="Operation details">
        <button
          className="dialog-close"
          onClick={onClose}
          aria-label="Close details"
        >
          <X />
        </button>
        <p className="eyebrow">{operation.type} operation</p>
        <h2>{operation.id.slice(0, 12)}</h2>
        <StatusPill status={operation.status} />
        <dl>
          <div>
            <dt>Created</dt>
            <dd>{new Date(operation.createdAt).toLocaleString()}</dd>
          </div>
          {operation.startedAt && (
            <div>
              <dt>Started</dt>
              <dd>{new Date(operation.startedAt).toLocaleString()}</dd>
            </div>
          )}
          <div>
            <dt>Content expiry</dt>
            <dd>
              {operation.contentExpiresAt
                ? new Date(operation.contentExpiresAt).toLocaleString()
                : "Not reported"}
            </dd>
          </div>
          {operation.provider && (
            <div>
              <dt>Provider</dt>
              <dd>{operation.provider}</dd>
            </div>
          )}
        </dl>
        {operation.error && (
          <div className="notice notice--error">
            <strong>{operation.error.code}</strong>
            <br />
            {operation.error.message}
          </div>
        )}
        {operation.request !== undefined && (
          <>
            <h3>Request</h3>
            <pre>{JSON.stringify(operation.request, null, 2)}</pre>
          </>
        )}
        {operation.result !== undefined && operation.result !== null && (
          <>
            <h3>Result preview</h3>
            <pre>{JSON.stringify(operation.result, null, 2)}</pre>
          </>
        )}
        <div className="drawer-actions">
          {(["json", "jsonl", "markdown"] as const).map((format) => (
            <a
              className="button"
              href={`/v1/operations/${operation.id}/export?format=${format}`}
              download
              key={format}
            >
              <FileDown size={16} />
              {format === "markdown" ? "Markdown" : format.toUpperCase()}
            </a>
          ))}
          {active && (
            <button className="button" onClick={() => void action("POST")}>
              <Square size={14} />
              Cancel
            </button>
          )}
          <button
            className="button button--danger"
            onClick={() => void action("DELETE")}
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </aside>
    </div>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [selected, setSelected] = useState<Operation | null>(null);
  const loadOperations = useCallback(async () => {
    setLoading(true);
    try {
      const value = await api<OperationList>("/v1/operations?limit=50");
      setOperations(value.data);
      setNextCursor(value.nextCursor ?? null);
    } catch (error) {
      if (
        error instanceof Error &&
        "status" in error &&
        (error as { status: number }).status === 401
      )
        setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);
  const loadMoreOperations = useCallback(async () => {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const value = await api<OperationList>(
        `/v1/operations?limit=50&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setOperations((current) => [
        ...current,
        ...value.data.filter(
          (item) => !current.some((existing) => existing.id === item.id),
        ),
      ]);
      setNextCursor(value.nextCursor ?? null);
    } finally {
      setLoading(false);
    }
  }, [nextCursor]);
  const loadHealth = useCallback(async () => {
    try {
      const [basic, ready] = await Promise.all([
        api<{ status: string; version?: string }>("/health"),
        api<{
          status: string;
          database?: boolean;
          providers?: { brave?: boolean; openai?: boolean };
        }>("/health/ready"),
      ]);
      setHealth({
        status: ready.status === "ready" ? "ok" : "degraded",
        version: basic.version,
        services: { postgresql: ready.database ? "ok" : "unavailable" },
        providers: ready.providers,
        retentionDays: 30,
      });
    } catch {
      setHealth(null);
    }
  }, []);
  const initialize = useCallback(async () => {
    try {
      const session = await api<{ data: { authenticated: boolean } }>(
        "/v1/admin/session",
      );
      setAuthenticated(session.data.authenticated);
      if (session.data.authenticated) {
        void loadOperations();
        void loadHealth();
      }
    } catch {
      setAuthenticated(false);
    }
  }, [loadHealth, loadOperations]);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => void loadOperations(), 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, loadOperations]);
  useEffect(() => {
    setNotice(null);
    setMenuOpen(false);
    document.title = `${titles[view].title} · Stratafetch`;
  }, [view]);
  const groupedNav = useMemo(
    () =>
      ["Workspace", "Capabilities", "Manage"].map((group) => ({
        group,
        items: nav.filter((item) => item.group === group),
      })),
    [],
  );
  if (authenticated === null)
    return (
      <div className="boot">
        <div className="brand brand--large">
          <span className="brand__mark">
            <i />
            <i />
            <i />
          </span>
          <span>STRATAFETCH</span>
        </div>
        <span>Loading console…</span>
      </div>
    );
  if (!authenticated)
    return (
      <Login
        onLogin={() => {
          setAuthenticated(true);
          void loadOperations();
          void loadHealth();
        }}
      />
    );
  async function logout() {
    try {
      await api("/v1/admin/session", { method: "DELETE" });
    } finally {
      setAuthenticated(false);
    }
  }
  const page = titles[view];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}>
        <div className="brand">
          <span className="brand__mark">
            <i />
            <i />
            <i />
          </span>
          <span>STRATAFETCH</span>
          <b>1.0</b>
        </div>
        <nav aria-label="Primary navigation">
          {groupedNav.map(({ group, items }) => (
            <div className="nav-group" key={group}>
              <p>{group}</p>
              {items.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={view === id ? "active" : ""}
                  onClick={() => setView(id)}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  {view === id && <i />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="connection">
            <span className={health?.status === "ok" ? "online" : "offline"} />
            <div>
              <b>Self-hosted</b>
              <small>{health?.status ?? "status unknown"}</small>
            </div>
          </div>
          <button onClick={() => void logout()} aria-label="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <main className="main" id="main-content">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </button>
          <div>
            <p className="eyebrow">{page.eyebrow}</p>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
          </div>
          <div className="top-actions">
            <span className="live-indicator">
              <i />
              Live
            </span>
            <button
              className="icon-button"
              aria-label="Refresh data"
              onClick={() => {
                void loadOperations();
                void loadHealth();
              }}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <div className="content">
          {notice && (
            <div className={`notice notice--${notice.tone}`} role="status">
              <span>{notice.message}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}
          {view === "overview" && (
            <Overview
              operations={operations}
              health={health}
              onNavigate={setView}
              onSelect={setSelected}
            />
          )}
          {view === "operations" && (
            <OperationsView
              operations={operations}
              loading={loading}
              refresh={() => void loadOperations()}
              loadMore={() => void loadMoreOperations()}
              hasMore={Boolean(nextCursor)}
              onSelect={setSelected}
            />
          )}
          {["fetch", "survey", "collect", "search", "shape"].includes(view) && (
            <CapabilityView
              type={view as Capability}
              setNotice={setNotice}
              onCreated={() => {
                void loadOperations();
                setView("operations");
              }}
            />
          )}
          {view === "keys" && <KeysView setNotice={setNotice} />}
          {view === "system" && (
            <SystemView health={health} refresh={() => void loadHealth()} />
          )}
        </div>
      </main>
      {selected && (
        <OperationDrawer
          operation={selected}
          onClose={() => setSelected(null)}
          onChanged={() => void loadOperations()}
        />
      )}
    </div>
  );
}
