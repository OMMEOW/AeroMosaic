"use client";

import { useRef, useState } from "react";
import type { VideoAsset } from "@/services";
import { fmtVideoTime } from "@/lib/format";
import { IconAlert, IconX } from "@/components/ui/icons";
import { Button, cn, Tooltip } from "@/components/ui/primitives";

function PlayGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5z" fill="currentColor" />
    </svg>
  );
}

/**
 * First-frame thumbnail of an uploaded video, with an inline preview player.
 * Media URLs come from the service (thumbnail.jpg / preview.mp4 on the real
 * backend); nothing here talks to the network directly.
 */
export function VideoPreview({ asset, className }: { asset: VideoAsset; className?: string }) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  const { probe, thumbnailUrl, previewUrl } = asset;
  const unavailable = previewUrl
    ? null
    : "No playable preview for this video. The backend has not produced a preview proxy (the mock only keeps files uploaded in this session).";

  const open = () => {
    if (!previewUrl) return;
    setError(null);
    setPlaying(true);
  };
  const close = () => {
    player.current?.pause();
    setPlaying(false);
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div
        className="relative aspect-video w-full overflow-hidden rounded-md border border-line bg-inset"
        onKeyDown={(e) => e.key === "Escape" && playing && close()}
      >
        {playing && previewUrl ? (
          <>
            <video
              ref={player}
              src={previewUrl}
              poster={thumbnailUrl ?? undefined}
              controls
              autoPlay
              muted
              playsInline
              className="size-full bg-black object-contain"
              aria-label={`Preview of ${probe.filename}`}
              onError={() => {
                setPlaying(false);
                setError(`This browser can't play ${probe.filename} (${probe.codec}). The pipeline still decodes it with ffmpeg.`);
              }}
            />
            <button
              type="button"
              onClick={close}
              aria-label="Close preview"
              className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md bg-black/60 text-white/85 hover:bg-black/80"
            >
              <IconX size={12} />
            </button>
          </>
        ) : (
          <>
            {thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- service-provided thumbnail (data/blob/backend URL)
              <img src={thumbnailUrl} alt={`First frame of ${probe.filename}`} className="size-full object-contain" />
            ) : previewUrl ? (
              // No extracted thumbnail: let the browser show the first frame of the preview itself.
              <video src={`${previewUrl}#t=0.001`} preload="metadata" muted playsInline className="size-full object-contain" aria-label={`First frame of ${probe.filename}`} />
            ) : (
              <div className="flex size-full items-center justify-center p-4 text-center text-xs text-fg-subtle">No thumbnail available yet</div>
            )}
            <span className="num pointer-events-none absolute bottom-2 left-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-2xs text-white/85">
              first frame · f0000
            </span>
            <span className="num pointer-events-none absolute right-2 bottom-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-2xs text-white/85">
              {fmtVideoTime(probe.durationMs)}
            </span>
            {previewUrl ? (
              <button
                type="button"
                onClick={open}
                aria-label={`Play preview of ${probe.filename}`}
                className="absolute inset-0 m-auto inline-flex size-12 items-center justify-center rounded-full bg-black/55 pl-0.5 text-white shadow-pop transition-colors hover:bg-accent hover:text-accent-fg"
              >
                <PlayGlyph />
              </button>
            ) : (
              <Tooltip content={unavailable}>
                <span
                  role="img"
                  aria-label={unavailable ?? undefined}
                  className="absolute inset-0 m-auto inline-flex size-12 cursor-not-allowed items-center justify-center rounded-full bg-black/40 pl-0.5 text-white/40"
                >
                  <PlayGlyph />
                </span>
              </Tooltip>
            )}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={playing ? <IconX size={12} /> : <PlayGlyph size={11} />}
          disabledReason={!playing ? unavailable : null}
          onClick={playing ? close : open}
        >
          {playing ? "Close preview" : "Preview video"}
        </Button>
        {error && (
          <span role="alert" className="inline-flex items-start gap-1.5 text-xs text-warn">
            <IconAlert size={12} className="mt-0.5 shrink-0" />
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
