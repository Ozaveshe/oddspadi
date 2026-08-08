import { Fragment } from "react";
import { LINK_PATTERN, isSafeLinkHost } from "@/lib/community/contentSafety";

// The single render path for user-authored community text. Everything is a
// React text node (auto-escaped); only links whose host passes the safety
// check become anchors, always rel="nofollow ugc noopener noreferrer".
export function CommunityBody({ text, className }: { text: string; className?: string }) {
  const parts = text.split(new RegExp(`(${LINK_PATTERN.source})`, "gi"));
  return (
    <p className={className} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>
      {parts.map((part, index) => {
        const isLinkCandidate = index % 2 === 1;
        if (isLinkCandidate && isSafeLinkHost(part)) {
          const href = /^https?:\/\//i.test(part) ? part : `https://${part}`;
          return (
            <a key={index} href={href} rel="nofollow ugc noopener noreferrer" target="_blank">
              {part}
            </a>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </p>
  );
}
