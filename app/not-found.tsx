import { StatusMessage } from "@/components/StatusMessage";

// Unknown routes (UX-13): a way back instead of Next's bare 404.
export default function NotFound() {
  return (
    <main>
      <StatusMessage
        title="This page isn't here"
        body="The link may be incomplete or out of date."
        action={{ label: "Back to Feed", href: "/" }}
      />
    </main>
  );
}
