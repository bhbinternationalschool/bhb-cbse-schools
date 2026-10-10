/**
 * The parent's side of giving a child their own WhatsApp number.
 *
 * Split from waStudentLink.server so the parent bot pulls in only the
 * parent half — the student half imports the tutor, and the fee bot has no
 * business loading that to answer LINK.
 */

import "server-only";

import type { Household, SisStudent } from "@/lib/sis";
import { loadMasters } from "@/lib/masters";
import { classLabel as classLabelOf } from "@/lib/homework";
import {
  composeLinkCodeText,
  composeLinkMenu,
  type ParentLinkCommand,
} from "@/lib/waStudentLinkEngine";
import {
  issueStudentLinkCode,
  listStudentLinks,
  revokeStudentLink,
} from "@/lib/waStudentLink.server";

export async function handleParentLinkCommand(opts: {
  household: Household;
  children: SisStudent[];
  mobile10: string;
  command: ParentLinkCommand;
}): Promise<{ replyText: string }> {
  const kids = opts.children.filter((s) => s.status === "active");
  const masters = loadMasters();
  const refs = kids.map((s) => ({
    id: s.id,
    name: s.fullName,
    classLabel: classLabelOf(masters, s.classId, s.sectionId).replace(" · ", " "),
  }));

  const links = await listStudentLinks(opts.household.id).catch(() => []);
  const linkedFor = (studentId: string) =>
    links.find((l) => l.studentId === studentId)?.mobile10;

  const menu = () =>
    composeLinkMenu({
      children: refs.map((r) => ({
        name: r.name,
        classLabel: r.classLabel,
        linkedMobile10: linkedFor(r.id),
      })),
    });

  const command = opts.command;
  if (command.kind === "list" || command.kind === "none") {
    return { replyText: menu() };
  }

  const index = command.index - 1;
  const child = refs[index];
  if (!child) {
    return {
      replyText: `Pick a number between 1 and ${refs.length}.\n\n${menu()}`,
    };
  }

  if (command.kind === "revoke") {
    const r = await revokeStudentLink({
      householdId: opts.household.id,
      studentId: child.id,
      byMobile10: opts.mobile10,
    });
    return {
      replyText: r.ok
        ? `Removed. ${child.name}'s own number can no longer use study help.\n\nReply *LINK* to set one up again.`
        : `That could not be removed just now. Please try again.`,
    };
  }

  const issued = await issueStudentLinkCode({
    householdId: opts.household.id,
    studentId: child.id,
    studentMobile10: command.mobile10,
    requestedByMobile10: opts.mobile10,
  });
  if (!issued.ok) return { replyText: issued.reason };

  return {
    replyText: composeLinkCodeText({
      code: issued.code,
      childName: child.name,
      mobile10: command.mobile10,
    }),
  };
}
