"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import {
  DEFAULT_OPTIONS,
  type Options,
  type OutputFile,
  type ToolId,
} from "@/lib/types";
import {
  isImageTool,
  readableError,
  signature,
  validateKind,
  validateName,
  validateSelection,
} from "@/lib/validation";

const TOOLS: {
  id: ToolId;
  title: string;
  description: string;
  color: string;
  action: string;
}[] = [
  {
    id: "pdf-images",
    title: "PDF to Images",
    description: "Turn pages into JPG or PNG.",
    color: "coral",
    action: "Convert to images",
  },
  {
    id: "images-pdf",
    title: "Images to PDF",
    description: "Combine JPG and PNG into a PDF.",
    color: "blue",
    action: "Create PDF",
  },
  {
    id: "image-converter",
    title: "Image Converter",
    description: "Switch between JPG, PNG & WebP.",
    color: "purple",
    action: "Convert images",
  },
  {
    id: "merge",
    title: "Merge PDF",
    description: "Bring your documents together.",
    color: "mint",
    action: "Merge PDFs",
  },
  {
    id: "extract",
    title: "Extract Pages",
    description: "Keep the pages you need.",
    color: "amber",
    action: "Extract pages",
  },
  {
    id: "rotate",
    title: "Rotate PDF",
    description: "Get every page facing right.",
    color: "pink",
    action: "Rotate pages",
  },
];
type Result = OutputFile & { url: string };
const sizeLabel = (size: number) =>
  size < 1024 ** 2
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / 1024 ** 2).toFixed(1)} MB`;

export default function Converter() {
  const [tool, setTool] = useState<ToolId>("pdf-images");
  const [files, setFiles] = useState<File[]>([]);
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [results, setResults] = useState<Result[]>([]);
  const [archive, setArchive] = useState<Result>();
  const [selected, setSelected] = useState(0);
  const [thumbnail, setThumbnail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const workbench = useRef<HTMLElement>(null);
  const controller = useRef<AbortController | null>(null);
  const previewController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const urls = useRef<string[]>([]);
  const pickerGeneration = useRef(0);
  const privacyDialog = useRef<HTMLDialogElement>(null);
  const current = TOOLS.find((item) => item.id === tool)!;
  const multiple = ["images-pdf", "image-converter", "merge"].includes(tool);
  const accept = isImageTool(tool)
    ? tool === "images-pdf"
      ? ".jpg,.jpeg,.png"
      : ".jpg,.jpeg,.png,.webp"
    : ".pdf";

  const clearResults = useCallback(() => {
    previewController.current?.abort();
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current = [];
    setResults([]);
    setArchive(undefined);
    setThumbnail("");
    setSelected(0);
  }, []);
  const clearSession = useCallback(() => {
    generation.current++;
    pickerGeneration.current++;
    controller.current?.abort();
    controller.current = null;
    clearResults();
    setFiles([]);
    setBusy(false);
    setMessage("");
    setError("");
    setProgress(0);
    setDragging(false);
    if (input.current) input.current.value = "";
  }, [clearResults]);
  useEffect(() => {
    const onHide = () => clearSession();
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) clearSession();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
      controller.current?.abort();
      previewController.current?.abort();
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [clearSession]);
  useEffect(() => {
    if (privacy) privacyDialog.current?.showModal();
    else privacyDialog.current?.close();
  }, [privacy]);

  function chooseTool(id: ToolId) {
    if (id !== tool) {
      clearSession();
      setTool(id);
      setOptions({
        ...DEFAULT_OPTIONS,
        format: id === "image-converter" ? "jpeg" : "png",
      });
    }
    workbench.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  }
  async function addFiles(incoming: File[]) {
    const ticket = ++pickerGeneration.current;
    const next = multiple ? [...files, ...incoming] : incoming;
    try {
      validateSelection(next, tool);
      for (const file of incoming) {
        const kind = signature(
          new Uint8Array(await file.slice(0, 32).arrayBuffer()),
        );
        validateKind(tool, kind);
        validateName(file.name, kind);
      }
      if (ticket !== pickerGeneration.current) return;
      clearResults();
      setFiles(next);
      setError("");
      setMessage("");
    } catch (e) {
      if (ticket === pickerGeneration.current) setError(readableError(e));
    }
  }
  function changeOptions(patch: Partial<Options>) {
    clearResults();
    setMessage("");
    setOptions((value) => ({ ...value, ...patch }));
  }
  function removeFile(index: number) {
    pickerGeneration.current++;
    clearResults();
    setFiles((value) => value.filter((_, i) => i !== index));
    setMessage("");
    setError("");
  }
  function moveFile(index: number, offset: number) {
    pickerGeneration.current++;
    clearResults();
    setMessage("");
    setFiles((value) => {
      const next = [...value];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  }
  function resultWithUrl(file: OutputFile): Result {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(file.bytes)], { type: file.mime }),
    );
    urls.current.push(url);
    return { ...file, url };
  }
  async function showPreview(result: Result) {
    previewController.current?.abort();
    const abort = new AbortController();
    previewController.current = abort;
    setThumbnail("");
    if (result.mime.startsWith("image/")) {
      setThumbnail(result.url);
      return;
    }
    if (result.mime === "application/pdf") {
      try {
        const { pdfThumbnail } = await import("@/lib/pdf-render");
        if (abort.signal.aborted) return;
        const image = await pdfThumbnail(result.bytes, abort.signal);
        if (!abort.signal.aborted) setThumbnail(image);
      } catch {
        /* A failed preview must not prevent downloading a successfully created file. */
      }
    }
  }
  async function run() {
    clearResults();
    setError("");
    setBusy(true);
    setMessage("Checking files");
    setProgress(0);
    const abort = new AbortController();
    controller.current = abort;
    const ticket = ++generation.current;
    try {
      const { convert } = await import("@/lib/engine");
      abort.signal.throwIfAborted();
      const output = await convert(
        tool,
        files,
        options,
        (text, percent) => {
          if (generation.current === ticket) {
            setMessage(text);
            setProgress(percent);
          }
        },
        abort.signal,
      );
      if (ticket !== generation.current || abort.signal.aborted) return;
      const ready = output.outputs.map(resultWithUrl);
      setResults(ready);
      setArchive(output.archive ? resultWithUrl(output.archive) : undefined);
      setProgress(100);
      setMessage("Your files are ready.");
      if (ready[0]) void showPreview(ready[0]);
    } catch (e) {
      if (ticket !== generation.current) return;
      if (abort.signal.aborted)
        setMessage("Cancelled. Your input files are still here.");
      else {
        setError(readableError(e));
        setMessage("");
      }
    } finally {
      if (generation.current === ticket) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  function cancel() {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    clearResults();
    setBusy(false);
    setProgress(0);
    setMessage("Cancelled. Your input files are still here.");
  }

  return (
    <>
      <a className="skip-link" href="#workspace">
        Skip to converter
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a
            className="brand"
            href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`}
            aria-label="San Doc Convert home"
          >
            <span className="brand-mark">
              <Icon name="document" size={21} />
            </span>
            <span>
              san<span className="brand-light">doc</span>
              <span className="brand-dot">.</span>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <button className="nav-button" onClick={() => setPrivacy(true)}>
              Privacy
            </button>
            <span className="header-local">
              <span className="status-dot" />
              On-device processing
            </span>
          </nav>
        </div>
      </header>
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="eyebrow">
            <span className="tiny-dot" /> YOUR EVERYDAY FILE TOOLKIT
          </div>
          <h1 id="hero-title">
            Convert PDFs and images
            <br />
            <span>on your device.</span>
          </h1>
          <p>
            Convert images or adjust PDF pages right in your browser.
            <br className="desktop-break" /> Your files stay on your device.
          </p>
          <div className="hero-notes">
            <span>
              <Icon name="shield" size={16} />
              Files stay on your device
            </span>
            <span className="note-separator" />
            <span>
              <Icon name="bolt" size={16} />
              Ready when you are
            </span>
          </div>
        </section>

        <section
          className="tools-section shell"
          aria-labelledby="tools-heading"
        >
          <div className="section-kicker">
            <h2 id="tools-heading">What would you like to do?</h2>
            <span>6 tools. One simple workspace.</span>
          </div>
          <div className="tool-grid">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                aria-pressed={tool === item.id}
                className={`tool-card ${tool === item.id ? "is-active" : ""}`}
                onClick={() => chooseTool(item.id)}
              >
                <span className={`tool-icon ${item.color}`}>
                  <Icon name={item.id} size={25} />
                </span>
                <span className="tool-copy">
                  <span className="tool-title">{item.title}</span>
                  <span className="tool-description">{item.description}</span>
                </span>
                <span className="tool-indicator">
                  {tool === item.id ? (
                    <Icon name="check" size={13} />
                  ) : (
                    <Icon name="arrow" size={16} />
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section
          className="workspace shell"
          id="workspace"
          ref={workbench}
          aria-labelledby="workspace-title"
          tabIndex={-1}
        >
          <div className="workspace-top">
            <div className="workspace-title">
              <span className={`tool-icon small ${current.color}`}>
                <Icon name={tool} size={20} />
              </span>
              <div>
                <h2 id="workspace-title">{current.title}</h2>
                <p>
                  {results.length
                    ? "Your result is ready to download."
                    : "Choose files and adjust your settings."}
                </p>
              </div>
            </div>
            <button
              className="text-button"
              onClick={clearSession}
              disabled={!files.length && !error && !message}
            >
              Clear all <Icon name="close" size={15} />
            </button>
          </div>
          <div className="workspace-grid">
            <div className="file-panel">
              <div className="panel-label">
                <span className="step-number">01</span>
                <h3>Your files</h3>
                <span className="file-count">
                  {files.length ? `${files.length} selected` : "Start here"}
                </span>
              </div>
              <input
                ref={input}
                id="file-picker"
                hidden
                tabIndex={-1}
                type="file"
                accept={accept}
                multiple={multiple}
                disabled={busy}
                aria-label="Choose files"
                onChange={(event) => {
                  const chosen = Array.from(event.target.files || []);
                  event.target.value = "";
                  if (chosen.length) void addFiles(chosen);
                }}
              />
              {!results.length && (
                <div
                  className={`dropzone ${dragging ? "is-dragging" : ""} ${files.length ? "compact" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (!busy) setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    if (!busy && event.dataTransfer.files.length)
                      void addFiles(Array.from(event.dataTransfer.files));
                  }}
                >
                  {!files.length && (
                    <>
                      <div className="upload-art">
                        <Icon name="document" size={36} />
                        <span>
                          <Icon name="upload" size={15} />
                        </span>
                      </div>
                      <h4>Choose a file to begin.</h4>
                      <p>
                        Drop your {isImageTool(tool) ? "images" : "PDFs"} here,
                        or choose from your device.
                      </p>
                    </>
                  )}
                  <button
                    className={
                      files.length ? "secondary-button" : "primary-button"
                    }
                    disabled={busy}
                    onClick={() => input.current?.click()}
                  >
                    <Icon
                      name={files.length ? "upload" : "document"}
                      size={18}
                    />
                    {files.length && multiple
                      ? "Add files"
                      : files.length
                        ? "Replace file"
                        : "Choose files"}
                    {!files.length && <Icon name="arrow" size={17} />}
                  </button>
                  <span className="dropzone-hint">
                    {tool === "images-pdf"
                      ? "JPG, PNG"
                      : tool === "image-converter"
                        ? "JPG, PNG, WebP"
                        : "PDF"}{" "}
                    · Up to 20 MiB per file
                  </span>
                </div>
              )}
              {!!files.length && !results.length && (
                <ol className="file-list">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`}>
                      <span className="file-item-icon">
                        <Icon
                          name={isImageTool(tool) ? "pdf-images" : "document"}
                          size={20}
                        />
                      </span>
                      <div className="file-item-copy">
                        <span title={file.name}>{file.name}</span>
                        <small>{sizeLabel(file.size)}</small>
                      </div>
                      <div className="file-item-controls">
                        {multiple && files.length > 1 && (
                          <>
                            <button
                              className="icon-button"
                              aria-label={`Move ${file.name} up`}
                              disabled={busy || index === 0}
                              onClick={() => moveFile(index, -1)}
                            >
                              <Icon name="up" size={16} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Move ${file.name} down`}
                              disabled={busy || index === files.length - 1}
                              onClick={() => moveFile(index, 1)}
                            >
                              <Icon name="down" size={16} />
                            </button>
                          </>
                        )}
                        <button
                          className="icon-button remove-button"
                          aria-label={`Remove ${file.name}`}
                          disabled={busy}
                          onClick={() => removeFile(index)}
                        >
                          <Icon name="close" size={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {!!results.length && (
                <div className="results" aria-label="Conversion results">
                  <div className="result-heading">
                    <span className="success-icon">
                      <Icon name="check" size={18} />
                    </span>
                    <div>
                      <h4>Ready for your next step.</h4>
                      <p>
                        {results.length}{" "}
                        {results.length === 1 ? "file" : "files"} created on
                        your device.
                      </p>
                    </div>
                  </div>
                  <div className="result-preview">
                    {thumbnail ? (
                      <img
                        src={thumbnail}
                        alt={
                          results[selected].mime === "application/pdf"
                            ? "First page of the resulting PDF"
                            : `Preview of ${results[selected].name}`
                        }
                      />
                    ) : (
                      <div className="preview-placeholder">
                        <Icon name="document" size={44} />
                        <span>
                          Preview may be unavailable. Your download is ready.
                        </span>
                      </div>
                    )}
                  </div>
                  <ul className="result-list">
                    {results.map((result, index) => (
                      <li
                        key={result.name}
                        className={selected === index ? "selected-result" : ""}
                      >
                        <button
                          className="preview-select"
                          aria-pressed={selected === index}
                          onClick={() => {
                            setSelected(index);
                            void showPreview(result);
                          }}
                        >
                          <span>{result.name}</span>
                          <small>
                            {result.detail} · {sizeLabel(result.bytes.length)}
                          </small>
                        </button>
                        <a
                          className="icon-button"
                          href={result.url}
                          download={result.name}
                          aria-label={`Download ${result.name}`}
                        >
                          <Icon name="download" size={18} />
                        </a>
                      </li>
                    ))}
                  </ul>
                  <a
                    className="primary-button result-download"
                    href={(archive || results[0]).url}
                    download={(archive || results[0]).name}
                  >
                    <Icon name="download" size={18} />
                    {archive ? "Download all as ZIP" : "Download file"}
                  </a>
                  <button
                    className="text-button start-again"
                    onClick={clearSession}
                  >
                    Start with new files <Icon name="arrow" size={16} />
                  </button>
                </div>
              )}
              <div className="local-note">
                <Icon name="lock" size={14} />
                <span>Your files are processed here, never uploaded.</span>
              </div>
            </div>

            <aside className="options-panel" aria-label="Output settings">
              <div className="panel-label">
                <span className="step-number">02</span>
                <h3>Make it yours</h3>
              </div>
              <fieldset disabled={busy}>
                {(tool === "pdf-images" || tool === "image-converter") && (
                  <>
                    <label className="field-label" htmlFor="output-format">
                      Output format
                    </label>
                    <select
                      id="output-format"
                      value={options.format}
                      onChange={(e) =>
                        changeOptions({
                          format: e.target.value as Options["format"],
                        })
                      }
                    >
                      <option value="png">PNG · Crisp & transparent</option>
                      <option value="jpeg">JPG · Smaller file size</option>
                      {tool === "image-converter" && (
                        <option value="webp">WebP · Made for the web</option>
                      )}
                    </select>
                  </>
                )}
                {tool === "pdf-images" && (
                  <>
                    <label className="field-label" htmlFor="resolution">
                      Resolution
                    </label>
                    <select
                      id="resolution"
                      value={options.dpi}
                      onChange={(e) =>
                        changeOptions({ dpi: Number(e.target.value) })
                      }
                    >
                      <option value="72">72 DPI · Smallest size</option>
                      <option value="144">144 DPI · Everyday quality</option>
                      <option value="200">200 DPI · More detail</option>
                    </select>
                  </>
                )}
                {(tool === "pdf-images" || tool === "image-converter") &&
                  options.format !== "png" && (
                    <>
                      <label
                        className="field-label range-label"
                        htmlFor="quality"
                      >
                        Image quality <span>{options.quality}%</span>
                      </label>
                      <input
                        id="quality"
                        type="range"
                        min="30"
                        max="100"
                        step="5"
                        value={options.quality}
                        onChange={(e) =>
                          changeOptions({ quality: Number(e.target.value) })
                        }
                      />
                      {options.format === "jpeg" && (
                        <p className="field-help">
                          Transparent areas will have a white background.
                        </p>
                      )}
                    </>
                  )}
                {["pdf-images", "extract", "rotate"].includes(tool) && (
                  <>
                    <label className="field-label" htmlFor="page-range">
                      Pages
                    </label>
                    <input
                      id="page-range"
                      type="text"
                      maxLength={1000}
                      placeholder="All pages"
                      value={options.pages}
                      onChange={(e) => changeOptions({ pages: e.target.value })}
                      aria-describedby="pages-help"
                    />
                    <p className="field-help" id="pages-help">
                      Leave blank for all pages, or enter a range like 1-3,5.
                      Pages stay in document order.
                    </p>
                  </>
                )}
                {tool === "images-pdf" && (
                  <>
                    <label className="field-label" htmlFor="paper">
                      Page size
                    </label>
                    <select
                      id="paper"
                      value={options.paper}
                      onChange={(e) =>
                        changeOptions({
                          paper: e.target.value as Options["paper"],
                        })
                      }
                    >
                      <option value="a4">A4 · With comfortable margins</option>
                      <option value="original">
                        Fit to image · Edge to edge
                      </option>
                    </select>
                    <p className="field-help">
                      Each image becomes one page. Use the arrows to set the
                      order.
                    </p>
                  </>
                )}
                {tool === "rotate" && (
                  <>
                    <label className="field-label" htmlFor="rotation">
                      Rotate by
                    </label>
                    <select
                      id="rotation"
                      value={options.rotation}
                      onChange={(e) =>
                        changeOptions({ rotation: Number(e.target.value) })
                      }
                    >
                      <option value="90">90° clockwise</option>
                      <option value="180">180°</option>
                      <option value="270">90° counterclockwise</option>
                    </select>
                  </>
                )}
                {tool === "merge" && (
                  <div className="settings-explainer">
                    <Icon name="merge" size={32} />
                    <h4>In just the right order.</h4>
                    <p>
                      Add at least two PDFs. Use the arrows beside each file to
                      set their order in the finished document.
                    </p>
                  </div>
                )}
              </fieldset>
              <div className="settings-bottom">
                <div className="limits-note">
                  <Icon name="info" size={16} />
                  <p>
                    Up to 10 files, 50 MiB total, and 100 PDF pages per job.
                    Images are limited to 16 megapixels.
                  </p>
                </div>
                {busy ? (
                  <>
                    <div className="progress-meta">
                      <span>{progress}%</span>
                      <span>Processing on your device</span>
                    </div>
                    <progress
                      aria-label="Conversion progress"
                      max={100}
                      value={progress}
                    />
                    <button
                      className="secondary-button full-width"
                      onClick={cancel}
                    >
                      Cancel processing
                    </button>
                  </>
                ) : (
                  <button
                    className="primary-button full-width"
                    onClick={() => void run()}
                    disabled={
                      !files.length || (tool === "merge" && files.length < 2)
                    }
                  >
                    {current.action}
                    <Icon name="arrow" size={18} />
                  </button>
                )}
                <span className="settings-footnote">
                  {results.length
                    ? "Change a setting to make a new version."
                    : "Refreshing this page clears your session."}
                </span>
              </div>
            </aside>
          </div>
          <div className="feedback" aria-live="polite" role="status">
            {message && (
              <p className={results.length ? "success-message" : ""}>
                {busy && <span className="spinner" />}
                {message}
              </p>
            )}
          </div>
          {error && (
            <div className="error-message" role="alert">
              <Icon name="info" size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
        </section>

        <section
          className="how-section shell"
          id="how-it-works"
          aria-labelledby="how-title"
        >
          <div>
            <span className="eyebrow">LESS FUSS, MORE DONE</span>
            <h2 id="how-title">A simpler way to work with files.</h2>
          </div>
          <div className="how-grid">
            <article>
              <span className="how-number">01</span>
              <h3>Pick your tool.</h3>
              <p>Choose a new format or give your PDF a quick tidy-up.</p>
            </article>
            <article>
              <span className="how-number">02</span>
              <h3>Make your adjustments.</h3>
              <p>
                Add your files, choose your settings, and let your browser do
                the work.
              </p>
            </article>
            <article>
              <span className="how-number">03</span>
              <h3>Take it with you.</h3>
              <p>
                Preview the result and download it. Clear the workspace when
                you’re done.
              </p>
            </article>
          </div>
        </section>
        <section className="privacy-strip shell">
          <div className="privacy-strip-icon">
            <Icon name="shield" size={26} />
          </div>
          <div>
            <h2>File processing stays on your device.</h2>
            <p>
              File processing stays in your browser. Refresh the page and the
              workspace starts fresh.
            </p>
          </div>
          <button className="text-button" onClick={() => setPrivacy(true)}>
            About privacy <Icon name="arrow" size={17} />
          </button>
        </section>
      </main>
      <footer className="site-footer shell">
        <span>
          San Doc Convert <span className="footer-dot">·</span> A little less
          file friction.
        </span>
        <div>
          <button className="nav-button" onClick={() => setPrivacy(true)}>
            Privacy & limits
          </button>
          <a
            href="https://github.com/ahsanfirdaus1/San-Doc-Convert"
            target="_blank"
            rel="noreferrer"
          >
            Source code <Icon name="external" size={13} />
          </a>
        </div>
      </footer>
      <dialog
        ref={privacyDialog}
        className="privacy-dialog"
        onCancel={() => setPrivacy(false)}
        onClose={() => setPrivacy(false)}
        aria-labelledby="privacy-title"
      >
        <div className="dialog-heading">
          <span className="tool-icon mint">
            <Icon name="shield" size={25} />
          </span>
          <button
            className="icon-button"
            aria-label="Close privacy information"
            onClick={() => setPrivacy(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 id="privacy-title">Your files stay with you.</h2>
        <p>
          San Doc Convert reads and processes the files you choose inside your
          browser. Document contents and filenames are not uploaded to a server.
        </p>
        <h3>A temporary workspace</h3>
        <p>
          Files and results stay in application memory. Clear all, refresh, or
          leave the page to clear the workspace. Downloaded files remain on your
          device. Browser memory cleanup is not a guarantee of secure erasure.
        </p>
        <h3>The website and your connection</h3>
        <p>
          The website downloads its own code and conversion assets. It uses no
          analytics or persistent file storage. GitHub Pages may log connection
          information, including your IP address, when serving the website.
        </p>
        <h3>Working within your device’s limits</h3>
        <p>
          20 MiB per file, 50 MiB of input, 10 files, 100 PDF pages, 16
          megapixels per image, and 100 MiB of output per job. Smaller jobs work
          better on phones. Password-protected PDFs and animated WebP images are
          not supported.
        </p>
        <p>
          PDF tools may preserve existing document metadata or active content in
          downloaded files. The app previews PDF pages as images and does not
          execute document scripts. It is not a document sanitization service.
        </p>
        <a
          className="text-button"
          href="https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection"
          target="_blank"
          rel="noreferrer"
        >
          GitHub Pages data collection <Icon name="external" size={15} />
        </a>
        <button
          className="primary-button full-width"
          onClick={() => setPrivacy(false)}
        >
          Back to my files
        </button>
      </dialog>
    </>
  );
}
