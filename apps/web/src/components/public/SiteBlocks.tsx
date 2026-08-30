import Link from "next/link";
import {
  parseProse,
  youtubeId,
  type SiteBlock,
  type SiteMedia,
} from "@/lib/website";

/**
 * The public renderer for page blocks.
 *
 * It draws only what it understands and silently omits the rest. That is
 * deliberate: a block whose picture has since been objected to, or whose
 * kind is not wired up yet, must leave a clean gap rather than a broken
 * image or an error on the school's front page.
 *
 * Nothing here interprets stored markup. Text is text, and the site's own
 * typography is applied to it — so no one in the office can paste in broken
 * HTML or a third-party tracking pixel.
 */

function Prose({ heading, body }: { heading?: string; body: string }) {
  const nodes = parseProse(body);
  if (nodes.length === 0) return null;
  return (
    <section className="mx-auto max-w-3xl px-6">
      {heading ? (
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          {heading}
        </h2>
      ) : null}
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-slate-700">
        {nodes.map((node, i) =>
          node.type === "p" ? (
            <p key={i}>{node.text}</p>
          ) : (
            <ul key={i} className="list-disc space-y-1.5 pl-5">
              {node.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          ),
        )}
      </div>
    </section>
  );
}

function Picture({
  media,
  caption,
}: {
  media: SiteMedia | undefined;
  caption?: string;
}) {
  // Absent because consent was withdrawn, or the file was removed. Either
  // way the page renders without it rather than showing a broken frame.
  if (!media) return null;
  return (
    <figure className="mx-auto max-w-4xl px-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={media.url}
        alt={media.alt}
        width={media.width || undefined}
        height={media.height || undefined}
        className="w-full rounded-xl border border-slate-200 object-cover"
        loading="lazy"
      />
      {caption ? (
        <figcaption className="mt-2 text-center text-sm text-slate-500">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function Video({ youtube, title }: { youtube: string; title?: string }) {
  const id = youtubeId(youtube);
  if (!id) return null;
  return (
    <section className="mx-auto max-w-4xl px-6">
      {title ? (
        <h2 className="mb-4 text-2xl font-bold tracking-tight text-slate-900">
          {title}
        </h2>
      ) : null}
      <div className="relative overflow-hidden rounded-xl border border-slate-200 pt-[56.25%]">
        <iframe
          className="absolute inset-0 h-full w-full"
          // youtube-nocookie: no tracking cookie is set unless the visitor
          // actually plays the video.
          src={`https://www.youtube-nocookie.com/embed/${id}`}
          title={title || "Video"}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </section>
  );
}

type CardItem = { title?: string; body?: string; href?: string };

function Cards({ heading, items }: { heading?: string; items: CardItem[] }) {
  const usable = items.filter((c) => c.title);
  if (usable.length === 0) return null;
  return (
    <section className="mx-auto max-w-5xl px-6">
      {heading ? (
        <h2 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">
          {heading}
        </h2>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {usable.map((card, i) => {
          const inner = (
            <>
              <h3 className="text-base font-semibold text-slate-900">
                {card.title}
              </h3>
              {card.body ? (
                <p className="mt-1.5 text-sm leading-6 text-slate-600">
                  {card.body}
                </p>
              ) : null}
            </>
          );
          const className =
            "block rounded-xl border border-slate-200 bg-white p-5 transition-colors";
          // An internal link uses the router; anything else is left as a
          // plain anchor so an external address still works.
          if (card.href && card.href.startsWith("/")) {
            return (
              <Link
                key={i}
                href={card.href}
                className={`${className} hover:border-slate-300`}
              >
                {inner}
              </Link>
            );
          }
          if (card.href) {
            return (
              <a
                key={i}
                href={card.href}
                rel="noopener noreferrer"
                className={`${className} hover:border-slate-300`}
              >
                {inner}
              </a>
            );
          }
          return (
            <div key={i} className={className}>
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type StatItem = { value?: string; label?: string };

function Stats({ heading, items }: { heading?: string; items: StatItem[] }) {
  const usable = items.filter((s) => s.value && s.label);
  if (usable.length === 0) return null;
  return (
    <section className="mx-auto max-w-5xl px-6">
      {heading ? (
        <h2 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">
          {heading}
        </h2>
      ) : null}
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {usable.map((stat, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-center"
          >
            <dt className="order-2 mt-1 text-sm text-slate-600">
              {stat.label}
            </dt>
            <dd className="order-1 text-3xl font-bold tracking-tight text-slate-900">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type FaqItem = { q?: string; a?: string };

function Faq({ heading, items }: { heading?: string; items: FaqItem[] }) {
  const usable = items.filter((f) => f.q && f.a);
  if (usable.length === 0) return null;
  return (
    <section className="mx-auto max-w-3xl px-6">
      {heading ? (
        <h2 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">
          {heading}
        </h2>
      ) : null}
      <div className="divide-y divide-slate-200 border-y border-slate-200">
        {usable.map((item, i) => (
          // <details> so it works with JavaScript switched off, which on a
          // weak rural connection is not a hypothetical.
          <details key={i} className="group py-4">
            <summary className="cursor-pointer list-none text-base font-semibold text-slate-900 marker:content-none">
              {item.q}
            </summary>
            <p className="mt-2 text-[15px] leading-7 text-slate-700">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

const asList = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

export function SiteBlocks({
  blocks,
  media,
}: {
  blocks: SiteBlock[];
  media: Record<string, SiteMedia>;
}) {
  return (
    <div className="space-y-14 py-14">
      {blocks.map((block) => {
        const p = block.payload;
        switch (block.kind) {
          case "prose":
            return (
              <Prose
                key={block.id}
                heading={asStr(p.heading)}
                body={asStr(p.body)}
              />
            );
          case "image":
            return (
              <Picture
                key={block.id}
                media={media[asStr(p.mediaId)]}
                caption={asStr(p.caption)}
              />
            );
          case "video":
            return (
              <Video
                key={block.id}
                youtube={asStr(p.youtube)}
                title={asStr(p.title)}
              />
            );
          case "cards":
            return (
              <Cards
                key={block.id}
                heading={asStr(p.heading)}
                items={asList(p.items) as CardItem[]}
              />
            );
          case "stats":
            return (
              <Stats
                key={block.id}
                heading={asStr(p.heading)}
                items={asList(p.items) as StatItem[]}
              />
            );
          case "faq":
            return (
              <Faq
                key={block.id}
                heading={asStr(p.heading)}
                items={asList(p.items) as FaqItem[]}
              />
            );
          default:
            // A block that reads from another desk. Wiring these is Phase 4;
            // until then it leaves a gap rather than an error.
            return null;
        }
      })}
    </div>
  );
}
