import { defaultCache } from "@serwist/next/worker";
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

// Web push (SPEC.md §9, Phase 3). The payload is deliberately narrow — see
// convex/lib/push.ts — so nothing rendered here can leak a health-attribute
// match reason onto a lock screen.
type PushPayload = { title?: string; body?: string; url?: string; tag?: string };

self.addEventListener("push", (event: PushEvent) => {
  let data: PushPayload = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: "Food Recalls", body: event.data.text() };
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Food Recalls", {
      body: data.body ?? "",
      icon: "/icon-192",
      badge: "/icon-192",
      tag: data.tag,
      data: { url: data.url ?? "/" },
    }),
  );
});

// Deep link: focus an already-open tab on the same page, otherwise open one.
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const targetPath = new URL(url, self.location.origin).pathname;
      for (const client of allClients) {
        if ("focus" in client && new URL(client.url).pathname === targetPath) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
