import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';

const t = (key: string) => i18nService.t(key);

function getExtension(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? '' : name.slice(lastDot).toLowerCase();
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function useFileContent(artifact: Artifact): { data: ArrayBuffer | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (artifact.content) {
        try {
          const buf = dataUrlToArrayBuffer(artifact.content);
          if (!cancelled) { setData(buf); setLoading(false); }
        } catch (e) {
          if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); }
        }
        return;
      }

      if (artifact.filePath && window.electron?.dialog?.readFileAsDataUrl) {
        let filePath = artifact.filePath;
        if (filePath.startsWith('file:///')) {
          filePath = filePath.slice(7);
        } else if (filePath.startsWith('file://')) {
          filePath = filePath.slice(7);
        } else if (filePath.startsWith('file:/')) {
          filePath = filePath.slice(5);
        }
        try {
          const result = await window.electron.dialog.readFileAsDataUrl(filePath);
          if (cancelled) return;
          if (result?.success && result.dataUrl) {
            const buf = dataUrlToArrayBuffer(result.dataUrl);
            setData(buf);
          } else {
            setError(result?.error || 'Failed to read file');
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
        setLoading(false);
        return;
      }

      setError('No content available');
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [artifact.content, artifact.filePath]);

  return { data, loading, error };
}

// --- Docx Sub-Renderer (docx-preview, high-fidelity rendering) ---

const DOCX_BASE_WIDTH = 794; // A4 width in px at 96dpi

const DocxSubRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const { data, loading, error: loadError } = useFileContent(artifact);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (loadError) { setError(loadError); return; }
    if (!data || !containerRef.current) return;

    let cancelled = false;

    const render = async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        if (cancelled || !containerRef.current) return;

        containerRef.current.innerHTML = '';
        await renderAsync(data, containerRef.current, undefined, {
          className: 'docx-preview',
          inWrapper: true,
          breakPages: true,
          ignoreWidth: false,
          ignoreHeight: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });

        if (!cancelled) setRendered(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    render();
    return () => { cancelled = true; };
  }, [data, loadError]);

  // Adaptive zoom based on container width
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !rendered) return;

    const updateZoom = () => {
      const containerWidth = wrapper.clientWidth - 48; // account for padding
      if (containerWidth < DOCX_BASE_WIDTH) {
        const scale = containerWidth / DOCX_BASE_WIDTH;
        if (containerRef.current) {
          containerRef.current.style.zoom = String(scale);
        }
      } else {
        if (containerRef.current) {
          containerRef.current.style.zoom = '1';
        }
      }
    };

    const ro = new ResizeObserver(updateZoom);
    ro.observe(wrapper);
    updateZoom();

    return () => ro.disconnect();
  }, [rendered]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 text-sm p-4">
        {t('artifactDocumentError')}: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        {t('artifactDocumentLoading')}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="h-full overflow-auto p-6 bg-[#f5f5f5]">
      <div ref={containerRef} className="docx-container mx-auto" />
      <style>{`
        .docx-container .docx-preview {
          background: white;
          color: #000;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
          margin: 0 auto 16px;
          border-radius: 2px;
        }
        .docx-container .docx-preview section {
          padding: 20px 40px !important;
        }
      `}</style>
    </div>
  );
};

// --- Xlsx Sub-Renderer (virtual scrolling + cell styles + CSV/TSV support) ---

interface CellData {
  v: string;
  bgColor?: string;
  fontColor?: string;
  bold?: boolean;
}

interface SheetData {
  name: string;
  rows: CellData[][];
  colCount: number;
}

function isCsvOrTsv(fileName: string): boolean {
  const ext = fileName.toLowerCase();
  return ext.endsWith('.csv') || ext.endsWith('.tsv') || ext.endsWith('.txt');
}

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;

const XlsxSubRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const { data, loading, error: loadError } = useFileContent(artifact);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loadError) { setError(loadError); return; }
    if (!data) return;

    let cancelled = false;

    const parse = async () => {
      try {
        const XLSX = await import('xlsx');

        let workbook: ReturnType<typeof XLSX.read>;
        const fileName = artifact.fileName || artifact.filePath || '';

        if (isCsvOrTsv(fileName)) {
          const text = new TextDecoder('utf-8').decode(new Uint8Array(data));
          workbook = XLSX.read(text, { type: 'string' });
        } else {
          workbook = XLSX.read(new Uint8Array(data), { type: 'array', cellStyles: true });
        }

        const parsed: SheetData[] = workbook.SheetNames.map(name => {
          const sheet = workbook.Sheets[name];
          const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
          const colCount = range.e.c - range.s.c + 1;
          const rows: CellData[][] = [];

          for (let r = range.s.r; r <= range.e.r; r++) {
            const row: CellData[] = [];
            for (let c = range.s.c; c <= range.e.c; c++) {
              const addr = XLSX.utils.encode_cell({ r, c });
              const cell = sheet[addr];
              if (cell) {
                const cellData: CellData = { v: cell.w ?? String(cell.v ?? '') };
                if (cell.s) {
                  if (cell.s.fgColor?.rgb) cellData.bgColor = `#${cell.s.fgColor.rgb}`;
                  if (cell.s.color?.rgb) cellData.fontColor = `#${cell.s.color.rgb}`;
                  if (cell.s.bold) cellData.bold = true;
                }
                row.push(cellData);
              } else {
                row.push({ v: '' });
              }
            }
            rows.push(row);
          }

          return { name, rows, colCount };
        });

        if (!cancelled) setSheets(parsed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    parse();
    return () => { cancelled = true; };
  }, [data, loadError, artifact.fileName, artifact.filePath]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 text-sm p-4">
        {t('artifactDocumentError')}: {error}
      </div>
    );
  }

  if (loading || sheets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        {t('artifactDocumentLoading')}
      </div>
    );
  }

  const currentSheet = sheets[activeSheet];
  const headerRow = currentSheet.rows[0];
  const bodyRows = currentSheet.rows.slice(1);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white text-[#383a42]">
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-[#e0e0e0] shrink-0 overflow-x-auto">
          {sheets.map((sheet, i) => (
            <button
              key={i}
              onClick={() => setActiveSheet(i)}
              className={`px-2 py-0.5 text-xs rounded whitespace-nowrap transition-colors ${
                i === activeSheet
                  ? 'bg-[#217346]/10 text-[#217346] font-medium'
                  : 'text-[#666] hover:text-[#383a42] hover:bg-[#f0f2f5]'
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* Header */}
      {headerRow && (
        <div className="shrink-0 flex border-b border-[#e0e0e0] bg-[#f0f2f5]" style={{ height: HEADER_HEIGHT }}>
          {headerRow.map((cell, i) => (
            <div
              key={i}
              className="px-3 flex items-center text-xs font-medium text-[#383a42] border-r border-[#e0e0e0] last:border-r-0 min-w-[80px] max-w-[200px] truncate"
              style={{
                backgroundColor: cell.bgColor || undefined,
                color: cell.fontColor || undefined,
                fontWeight: cell.bold ? 700 : 600,
              }}
              title={cell.v}
            >
              {cell.v}
            </div>
          ))}
        </div>
      )}

      {/* Virtual scrolling body */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <VirtualRows rows={bodyRows} parentRef={parentRef} />
      </div>

      {/* Row count */}
      <div className="px-3 py-1 text-xs text-[#999] border-t border-[#e0e0e0] shrink-0">
        {currentSheet.rows.length.toLocaleString()} {t('artifactRowCount')}
      </div>
    </div>
  );
};

const VirtualRows: React.FC<{
  rows: CellData[][];
  parentRef: React.RefObject<HTMLDivElement | null>;
}> = ({ rows, parentRef }) => {
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  return (
    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
      {rowVirtualizer.getVirtualItems().map(virtualRow => {
        const row = rows[virtualRow.index];
        return (
          <div
            key={virtualRow.index}
            className={`flex items-center border-b border-[#e0e0e0]/50 text-xs ${virtualRow.index % 2 === 0 ? 'bg-white' : 'bg-[#f9fafb]'}`}
            style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualRow.start}px)`,
              height: ROW_HEIGHT,
              width: '100%',
            }}
          >
            {row.map((cell, ci) => (
              <div
                key={ci}
                className="px-3 flex items-center border-r border-[#e0e0e0]/30 last:border-r-0 min-w-[80px] max-w-[200px] truncate h-full"
                style={{
                  backgroundColor: cell.bgColor || undefined,
                  color: cell.fontColor || undefined,
                  fontWeight: cell.bold ? 700 : undefined,
                }}
                title={cell.v}
              >
                {cell.v}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

// --- Pptx Sub-Renderer ---

/**
 * Fix PPTX files generated by PptxGenJS:
 * 1. Re-compress with Deflate (some are stored uncompressed)
 * 2. Remove Content_Types.xml entries that reference non-existent files
 */
async function fixPptxData(data: ArrayBuffer): Promise<ArrayBuffer> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);

  // Fix Content_Types.xml: remove Override entries for missing files
  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    let ct = await ctFile.async('string');
    const overrideRe = /<Override[^>]+PartName="([^"]+)"[^>]*\/>/g;
    const toRemove: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = overrideRe.exec(ct)) !== null) {
      const partName = match[1];
      const zipPath = partName.startsWith('/') ? partName.slice(1) : partName;
      if (!zip.file(zipPath)) {
        toRemove.push(match[0]);
      }
    }
    for (const entry of toRemove) {
      ct = ct.replace(entry, '');
    }
    zip.file('[Content_Types].xml', ct);
  }

  // Re-generate with Deflate compression
  return await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

const PptxSubRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const { data, loading, error: loadError } = useFileContent(artifact);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const [slideCount, setSlideCount] = useState(0);

  const PPTX_RENDER_WIDTH = 600;

  useEffect(() => {
    if (loadError) { setError(loadError); return; }
    if (!data) return;

    let cancelled = false;

    const render = async () => {
      try {
        const pptxPreview = await import('pptx-preview');
        if (cancelled) return;

        // Fix the PPTX data before passing to pptx-preview
        const fixedData = await fixPptxData(data);
        if (cancelled) return;

        const offscreen = document.createElement('div');
        offscreen.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:600px;';
        document.body.appendChild(offscreen);

        const previewer = pptxPreview.init(offscreen, { width: PPTX_RENDER_WIDTH, mode: 'list' });
        await previewer.preview(fixedData);

        if (cancelled) { document.body.removeChild(offscreen); return; }

        const count = previewer.slideCount || 0;
        setSlideCount(count);

        const renderedHtml = offscreen.innerHTML;
        document.body.removeChild(offscreen);

        if (count > 0 && renderedHtml.length > 200 && iframeRef.current && !cancelled) {
          const iframeDoc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
          if (iframeDoc) {
            iframeDoc.open();
            iframeDoc.write(`<!DOCTYPE html><html><head><style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { background: #f3f4f6; padding: 16px; overflow-y: auto; }
              .pptx-preview-wrapper { background: transparent !important; width: 100% !important; max-width: 100% !important; height: auto !important; overflow: visible !important; }
              .pptx-preview-wrapper > div { margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); border-radius: 4px; overflow: hidden; }
              .pptx-preview-wrapper > div:last-child { margin-bottom: 0; }
              canvas { width: 100% !important; height: auto !important; display: block; }
            </style></head><body>${renderedHtml}</body></html>`);
            iframeDoc.close();
          }
          setRendered(true);
        } else {
          setError('render_failed');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    render();
    return () => { cancelled = true; };
  }, [data, loadError]);

  // Adaptive zoom for PPTX container
  useEffect(() => {
    const container = containerRef.current;
    const iframe = iframeRef.current;
    if (!container || !iframe || !rendered) return;

    const updateZoom = () => {
      const containerWidth = container.clientWidth;
      if (containerWidth < PPTX_RENDER_WIDTH) {
        iframe.style.zoom = String(containerWidth / PPTX_RENDER_WIDTH);
      } else {
        iframe.style.zoom = '1';
      }
    };

    const ro = new ResizeObserver(updateZoom);
    ro.observe(container);
    updateZoom();

    return () => ro.disconnect();
  }, [rendered]);

  // Fallback: HTML slides or text extraction when pptx-preview fails
  if (error === 'render_failed') {
    return <PptxHtmlFallback artifact={artifact} data={data!} />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 text-sm p-4">
        {t('artifactDocumentError')}: {error}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {slideCount > 0 && (
        <div className="px-3 py-1.5 text-xs text-muted border-b border-border shrink-0">
          {t('artifactSlideCount').replace('{count}', String(slideCount))}
        </div>
      )}
      <div ref={containerRef} className="flex-1 relative min-h-0">
        {(loading || !rendered) && (
          <div className="absolute inset-0 flex items-center justify-center text-muted text-sm z-10 bg-background">
            {t('artifactDocumentLoading')}
          </div>
        )}
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0"
          sandbox="allow-same-origin"
          title={artifact.title || 'PPTX Preview'}
        />
      </div>
    </div>
  );
};

// HTML slides fallback: load slideN.html files from the same directory
const PptxHtmlFallback: React.FC<{ artifact: Artifact; data: ArrayBuffer }> = ({ artifact, data }) => {
  const [slideHtmls, setSlideHtmls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [useTextFallback, setUseTextFallback] = useState(false);

  useEffect(() => {
    if (!artifact.filePath) { setUseTextFallback(true); setLoading(false); return; }

    let cancelled = false;

    const loadSlideHtmls = async () => {
      let filePath = artifact.filePath!;
      if (filePath.startsWith('file:///')) filePath = filePath.slice(7);
      else if (filePath.startsWith('file://')) filePath = filePath.slice(7);
      else if (filePath.startsWith('file:/')) filePath = filePath.slice(5);

      const dir = filePath.substring(0, filePath.lastIndexOf('/'));
      const slidesDir = `${dir}/slides`;
      const htmls: string[] = [];

      for (let i = 1; i <= 20; i++) {
        const slidePath = `${slidesDir}/slide${i}.html`;
        try {
          const result = await window.electron?.dialog?.readFileAsDataUrl(slidePath);
          if (!result?.success || !result.dataUrl) break;
          const base64 = result.dataUrl.split(',')[1] || '';
          const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const html = new TextDecoder('utf-8').decode(bytes);
          htmls.push(html);
        } catch {
          break;
        }
      }

      if (cancelled) return;

      if (htmls.length > 0) {
        setSlideHtmls(htmls);
      } else {
        setUseTextFallback(true);
      }
      setLoading(false);
    };

    loadSlideHtmls();
    return () => { cancelled = true; };
  }, [artifact.filePath]);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted text-sm">{t('artifactDocumentLoading')}</div>;
  }

  if (useTextFallback) {
    return <PptxTextFallback data={data} />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-3 py-1.5 text-xs text-muted border-b border-border shrink-0">
        {t('artifactSlideCount').replace('{count}', String(slideHtmls.length))}
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4 bg-[#f3f4f6]">
        {slideHtmls.map((html, i) => (
          <div key={i} className="shadow-lg rounded overflow-hidden">
            <iframe
              srcDoc={html}
              className="w-full border-0 rounded"
              style={{ aspectRatio: '16/9' }}
              sandbox="allow-same-origin"
              title={`Slide ${i + 1}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// Text extraction fallback for PPTX
interface SlideContent { index: number; texts: string[]; }

async function parsePptxSlides(data: ArrayBuffer): Promise<SlideContent[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
      const nb = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
      return na - nb;
    });

  const slides: SlideContent[] = [];
  const textRe = /<a:t>([^<]*)<\/a:t>/g;

  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.file(slideFiles[i])!.async('string');
    const texts: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = textRe.exec(xml)) !== null) {
      if (match[1].trim()) texts.push(match[1]);
    }
    textRe.lastIndex = 0;
    slides.push({ index: i + 1, texts });
  }
  return slides;
}

const PptxTextFallback: React.FC<{ data: ArrayBuffer }> = ({ data }) => {
  const [slides, setSlides] = useState<SlideContent[]>([]);
  const [parsed, setParsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    parsePptxSlides(data).then(result => {
      if (!cancelled) { setSlides(result); setParsed(true); }
    }).catch(() => { if (!cancelled) setParsed(true); });
    return () => { cancelled = true; };
  }, [data]);

  if (!parsed) {
    return <div className="flex items-center justify-center h-full text-muted text-sm">{t('artifactDocumentLoading')}</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-3 py-1.5 text-xs text-muted border-b border-border shrink-0">
        {t('artifactSlideCount').replace('{count}', String(slides.length))}
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {slides.map(slide => (
          <div key={slide.index} className="border border-border rounded-lg p-4 bg-surface">
            <div className="text-xs text-muted mb-2 font-medium">
              {t('artifactSlideLabel').replace('{n}', String(slide.index))}
            </div>
            {slide.texts.length > 0 ? (
              <div className="space-y-1">
                {slide.texts.map((text, i) => (
                  <div key={i} className="text-sm text-foreground">{text}</div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted italic">{t('artifactSlideNoText')}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Fallback Sub-Renderer ---

const FileInfoFallback: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const ext = getExtension(artifact.fileName || artifact.filePath || '');

  const handleOpenWithApp = useCallback(() => {
    if (artifact.filePath) {
      window.electron?.shell?.openPath(artifact.filePath);
    }
  }, [artifact.filePath]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
      <div className="text-5xl">
        {ext === '.pptx' ? '📊' : ext === '.xlsx' ? '📑' : '📄'}
      </div>
      <div className="text-center">
        <div className="text-sm font-medium">{artifact.fileName || artifact.title}</div>
        <div className="text-xs text-muted mt-1">{ext.toUpperCase().slice(1)}</div>
      </div>
      {artifact.filePath && (
        <button
          onClick={handleOpenWithApp}
          className="px-3 py-1.5 text-xs rounded bg-primary text-white hover:bg-primary/90 transition-colors mt-2"
        >
          {t('artifactOpenWithApp')}
        </button>
      )}
    </div>
  );
};

// --- Main Document Renderer ---

interface DocumentRendererProps {
  artifact: Artifact;
}

const DocumentRenderer: React.FC<DocumentRendererProps> = ({ artifact }) => {
  const ext = getExtension(artifact.fileName || artifact.filePath || '');

  switch (ext) {
    case '.docx':
      return <DocxSubRenderer artifact={artifact} />;
    case '.xlsx':
    case '.xls':
    case '.csv':
    case '.tsv':
      return <XlsxSubRenderer artifact={artifact} />;
    case '.pptx':
      return <PptxSubRenderer artifact={artifact} />;
    default:
      return <FileInfoFallback artifact={artifact} />;
  }
};

export default DocumentRenderer;
