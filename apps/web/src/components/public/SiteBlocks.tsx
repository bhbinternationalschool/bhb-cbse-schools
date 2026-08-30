import Link from "next/link";
import { EnquiryForm } from "@/components/public/EnquiryForm";
import type { LiveContent } from "@/lib/website.server";
import {
  describeBytes,
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

function SectionHeading({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <h2 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">
      {children}
    </h2>
  );
}

/** A date a parent reads, not an ISO string. */
function readableDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function Feed({
  heading,
  items,
}: {
  heading?: string;
  items: LiveContent["feed"];
}) {
  // Nothing has been ticked on yet. An empty heading over blank space looks
  // broken; no section at all simply looks like a page without news.
  if (!items || items.length === 0) return null;
  return (
    <section className="mx-auto max-w-5xl px-6">
      <SectionHeading>{heading}</SectionHeading>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <article
            key={item.id}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white"
          >
            {item.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.coverUrl}
                alt=""
                className="h-40 w-full object-cover"
                loading="lazy"
              />
            ) : null}
            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {item.kind === "news" ? "News" : "Notice"}
                {readableDate(item.publishedAt)
                  ? ` · ${readableDate(item.publishedAt)}`
                  : ""}
              </p>
              <h3 className="mt-1.5 text-base font-semibold text-slate-900">
                {item.title}
              </h3>
              {item.summary ? (
                <p className="mt-1.5 text-sm leading-6 text-slate-600">
                  {item.summary}
                </p>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Calendar({
  heading,
  items,
}: {
  heading?: string;
  items: LiveContent["events"];
}) {
  if (!items || items.length === 0) return null;
  return (
    <section className="mx-auto max-w-3xl px-6">
      <SectionHeading>{heading}</SectionHeading>
      <ul className="divide-y divide-slate-200 border-y border-slate-200">
        {items.map((event) => (
          <li key={event.id} className="flex gap-4 py-4">
            <div className="w-28 shrink-0 text-sm font-semibold text-slate-900">
              {readableDate(event.startsOn)}
              {event.startTime ? (
                <span className="block font-normal text-slate-500">
                  {event.startTime}
                </span>
              ) : null}
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900">
                {event.title}
              </p>
              {event.location ? (
                <p className="text-sm text-slate-500">{event.location}</p>
              ) : null}
              {event.description ? (
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {event.description}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Gallery({
  heading,
  album,
}: {
  heading?: string;
  album: LiveContent["album"];
}) {
  // Null when the album was never ticked on, or was taken off the site
  // after this block was placed. Both mean: show nothing.
  if (!album || album.photos.length === 0) return null;
  return (
    <section className="mx-auto max-w-5xl px-6">
      <SectionHeading>{heading || album.title}</SectionHeading>
      {album.description ? (
        <p className="-mt-4 mb-6 text-[15px] leading-7 text-slate-600">
          {album.description}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {album.photos.map((photo) => (
          <figure key={photo.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.caption || album.title}
              className="aspect-square w-full rounded-lg border border-slate-200 object-cover"
              loading="lazy"
            />
            {photo.caption ? (
              <figcaption className="mt-1 text-xs text-slate-500">
                {photo.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </section>
  );
}

function Downloads({
  heading,
  items,
  files,
}: {
  heading?: string;
  items: { mediaId?: string; label?: string }[];
  files: LiveContent["files"];
}) {
  const usable = items.filter((i) => i.mediaId && files?.[i.mediaId]);
  if (usable.length === 0) return null;
  return (
    <section className="mx-auto max-w-3xl px-6">
      <SectionHeading>{heading}</SectionHeading>
      <ul className="divide-y divide-slate-200 border-y border-slate-200">
        {usable.map((item, i) => {
          const file = files![item.mediaId as string];
          return (
            <li key={i} className="py-3">
              <a
                href={file.url}
                className="flex items-baseline justify-between gap-4 text-[15px] font-medium text-slate-900 underline-offset-2 hover:underline"
                // Opens rather than navigating away from the page the
                // parent was reading.
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{item.label || file.alt || file.originalFilename}</span>
                <span className="shrink-0 text-xs font-normal text-slate-500">
                  {describeBytes(file.bytes)}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function People({
  heading,
  items,
  people,
}: {
  heading?: string;
  items: { staffId?: string; role?: string }[];
  people: LiveContent["people"];
}) {
  // Somebody who has left the school drops out here without anyone having
  // to remember to edit the page.
  const usable = items.filter((i) => i.staffId && people?.[i.staffId]);
  if (usable.length === 0) return null;
  return (
    <section className="mx-auto max-w-5xl px-6">
      <SectionHeading>{heading}</SectionHeading>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {usable.map((item, i) => {
          const person = people![item.staffId as string];
          return (
            <li
              key={i}
              className="rounded-xl border border-slate-200 bg-white p-5"
            >
              <p className="text-base font-semibold text-slate-900">
                {person.name}
              </p>
              {item.role || person.role ? (
                <p className="mt-0.5 text-sm text-slate-600">
                  {item.role || person.role}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Enquiry({ heading, intro }: { heading?: string; intro?: string }) {
  return (
    <section className="mx-auto max-w-3xl px-6">
      <SectionHeading>{heading || "Ask about admission"}</SectionHeading>
      {intro ? (
        <p className="-mt-4 mb-5 text-[15px] leading-7 text-slate-600">
          {intro}
        </p>
      ) : null}
      <EnquiryForm classes={ENQUIRY_CLASSES} />
    </section>
  );
}

/** The classes the school actually admits to. Nursery to Class VIII —
 * the site must not offer a class the school does not run. */
const ENQUIRY_CLASSES = [
  "Nursery",
  "LKG",
  "UKG",
  "Class I",
  "Class II",
  "Class III",
  "Class IV",
  "Class V",
  "Class VI",
  "Class VII",
  "Class VIII",
];

const asList = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

export function SiteBlocks({
  blocks,
  media,
  live,
}: {
  blocks: SiteBlock[];
  media: Record<string, SiteMedia>;
  /** What each live block's pointer resolved to, keyed by block id. */
  live?: Record<string, LiveContent>;
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
          case "feed":
            return (
              <Feed
                key={block.id}
                heading={asStr(p.heading)}
                items={live?.[block.id]?.feed}
              />
            );
          case "calendar":
            return (
              <Calendar
                key={block.id}
                heading={asStr(p.heading)}
                items={live?.[block.id]?.events}
              />
            );
          case "gallery":
            return (
              <Gallery
                key={block.id}
                heading={asStr(p.heading)}
                album={live?.[block.id]?.album}
              />
            );
          case "downloads":
            return (
              <Downloads
                key={block.id}
                heading={asStr(p.heading)}
                items={asList(p.items)}
                files={live?.[block.id]?.files}
              />
            );
          case "people":
            return (
              <People
                key={block.id}
                heading={asStr(p.heading)}
                items={asList(p.items)}
                people={live?.[block.id]?.people}
              />
            );
          case "enquiry":
            return (
              <Enquiry
                key={block.id}
                heading={asStr(p.heading)}
                intro={asStr(p.intro)}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
