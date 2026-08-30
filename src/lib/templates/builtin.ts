/**
 * Built-in who-are-you templates. Onboarding asks who you are and hands
 * you a finished starting point — the best interface removes decisions.
 *
 * Registered through the same defineTemplate() API the community gets.
 */

import { newBlockId } from "../identity";
import { defineTemplate } from "../registry";
import type { Block, IdentityType } from "../identity";

let order = 0;
function blk(type: string, data: Record<string, unknown>): Block {
  return { id: newBlockId(), type, order: order++, data };
}

function seedBlocks(
  identityType: IdentityType,
  theme: string,
  bio: string,
  make: () => Block[],
): {
  blocks: Block[];
  identityType: IdentityType;
  bio: string;
  theme: string;
} {
  order = 0;
  return { blocks: make(), identityType, bio, theme };
}

defineTemplate({
  id: "creator",
  name: "Creator",
  vertical: "Content creators and influencers",
  description: "Latest drop up top, socials everywhere, everything tappable.",
  seed: ({ displayName }) =>
    seedBlocks("personal", "midnight", `${displayName} — creating daily.`, () => [
      blk("header", { text: "Latest" }),
      blk("link", { label: "Newest video", url: "https://", icon: "▶" }),
      blk("link", { label: "Merch", url: "https://", icon: "◆" }),
      blk("header", { text: "Everywhere else" }),
      blk("social", { links: [] }),
    ]),
});

defineTemplate({
  id: "salon",
  name: "Salon",
  vertical: "Salons, spas, and stylists",
  description: "Booking first, services second, socials third.",
  seed: ({ displayName }) =>
    seedBlocks("business", "rosegold", `${displayName} — book your next appointment.`, () => [
      blk("link", { label: "Book an appointment", url: "https://", icon: "✂" }),
      blk("header", { text: "Services & pricing" }),
      blk("text", { text: "Cut · Color · Style — full menu below." }),
      blk("link", { label: "Service menu", url: "https://", icon: "☰" }),
      blk("header", { text: "Follow the work" }),
      blk("social", { links: [] }),
    ]),
});

defineTemplate({
  id: "restaurant",
  name: "Restaurant",
  vertical: "Restaurants, cafes, and food trucks",
  description: "Menu, hours, reservations, delivery — the whole table.",
  seed: ({ displayName }) =>
    seedBlocks("business", "ember", `${displayName} — come hungry.`, () => [
      blk("link", { label: "Menu", url: "https://", icon: "☰" }),
      blk("link", { label: "Reserve a table", url: "https://", icon: "◷" }),
      blk("link", { label: "Order delivery", url: "https://", icon: "➤" }),
      blk("header", { text: "Hours" }),
      blk("text", { text: "Tue–Sun 11am–10pm" }),
    ]),
});

defineTemplate({
  id: "developer",
  name: "Developer",
  vertical: "Developers and open-source builders",
  description: "Projects, repos, writing, and where to hire you.",
  seed: ({ displayName }) =>
    seedBlocks("personal", "terminal", `${displayName} — I ship.`, () => [
      blk("header", { text: "Projects" }),
      blk("link", { label: "GitHub", url: "https://github.com/", icon: "⌥" }),
      blk("link", { label: "Featured project", url: "https://", icon: "◈" }),
      blk("header", { text: "Writing & contact" }),
      blk("link", { label: "Blog", url: "https://", icon: "✎" }),
      blk("social", { links: [] }),
    ]),
});

defineTemplate({
  id: "student",
  name: "Student",
  vertical: "Students and early-career portfolios",
  description: "Portfolio, resume, and the work that proves it.",
  seed: ({ displayName }) =>
    seedBlocks("personal", "midnight", `${displayName} — portfolio and projects.`, () => [
      blk("header", { text: "Portfolio" }),
      blk("link", { label: "Resume", url: "https://", icon: "▤" }),
      blk("link", { label: "Best project", url: "https://", icon: "★" }),
      blk("social", { links: [] }),
    ]),
});

defineTemplate({
  id: "photographer",
  name: "Photographer",
  vertical: "Photographers and visual artists",
  description: "Galleries up front, booking right behind.",
  seed: ({ displayName }) =>
    seedBlocks("personal", "mono", `${displayName} — available for bookings.`, () => [
      blk("link", { label: "Portfolio", url: "https://", icon: "◉" }),
      blk("link", { label: "Book a session", url: "https://", icon: "◷" }),
      blk("header", { text: "Recent work" }),
      blk("social", { links: [] }),
    ]),
});

defineTemplate({
  id: "musician",
  name: "Musician",
  vertical: "Musicians, bands, and producers",
  description: "Streaming everywhere, shows, and merch.",
  seed: ({ displayName }) =>
    seedBlocks("personal", "violet", `${displayName} — new music out now.`, () => [
      blk("header", { text: "Listen" }),
      blk("link", { label: "Spotify", url: "https://", icon: "♫" }),
      blk("link", { label: "Apple Music", url: "https://", icon: "♪" }),
      blk("header", { text: "Live" }),
      blk("link", { label: "Tour dates", url: "https://", icon: "◷" }),
      blk("social", { links: [] }),
    ]),
});

defineTemplate({
  id: "small-business",
  name: "Small Business",
  vertical: "Local shops and service businesses",
  description: "Contact, hours, offerings — the storefront that fits in a QR.",
  seed: ({ displayName }) =>
    seedBlocks("business", "pro", `${displayName} — local and proud of it.`, () => [
      blk("link", { label: "Call us", url: "tel:+1", icon: "☏" }),
      blk("link", { label: "What we do", url: "https://", icon: "◆" }),
      blk("header", { text: "Hours" }),
      blk("text", { text: "Mon–Fri 9am–6pm" }),
      blk("social", { links: [] }),
    ]),
});

defineTemplate({
  id: "nonprofit",
  name: "Nonprofit",
  vertical: "Nonprofits and community organizations",
  description: "Mission, donations, volunteering — action in one tap.",
  seed: ({ displayName }) =>
    seedBlocks("organization", "forest", `${displayName} — join the mission.`, () => [
      blk("link", { label: "Donate", url: "https://", icon: "♥" }),
      blk("link", { label: "Volunteer", url: "https://", icon: "✋" }),
      blk("header", { text: "Our mission" }),
      blk("text", { text: "What we do and why it matters." }),
      blk("social", { links: [] }),
    ]),
});

defineTemplate({
  id: "consultant",
  name: "Consultant",
  vertical: "Consultants and independent professionals",
  description: "Credibility, services, and a calendar link that converts.",
  seed: ({ displayName }) =>
    seedBlocks("personal", "pro", `${displayName} — let's talk.`, () => [
      blk("link", { label: "Book a call", url: "https://", icon: "◷" }),
      blk("header", { text: "Services" }),
      blk("text", { text: "How I help and who I help." }),
      blk("link", { label: "Case studies", url: "https://", icon: "▤" }),
      blk("social", { links: [] }),
    ]),
});
