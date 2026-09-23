// Marketing Studio presets, modelled on Higgsfield's Marketing Studio: ad formats,
// scroll-stopping hooks, and scene settings. Shared by the page and the server,
// which turns the chosen ones into the script, hero frame, and video prompt.

export const AD_FORMATS = [
  { id: "ugc", name: "UGC", blurb: "Realistic social media videos", group: "ugc", talking: true, person: true, direction: "Face-to-camera creator video shot on a phone: natural light, casual framing, genuine enthusiasm, speaking directly to the viewer about the product." },
  { id: "tutorial", name: "Tutorial", blurb: "Step-by-step tutorials", group: "ugc", talking: true, person: true, direction: "Step-by-step how-to: the person talks while demonstrating the product with their hands, clear close-ups of each step." },
  { id: "unboxing", name: "Unboxing", blurb: "High-quality unboxing", group: "ugc", talking: true, person: true, direction: "Package arrives, tape rips, the product is revealed from its packaging with a genuine, delighted reaction and tactile close-ups." },
  { id: "product-review", name: "Product Review", blurb: "Authentic product reviews", group: "ugc", talking: true, person: true, direction: "Close, hands-on review with natural voiceover, shot on a phone in a real room, showing texture and details while giving an honest verdict." },
  { id: "ugc-try-on", name: "UGC Virtual Try On", blurb: "Try before you buy", group: "ugc", talking: true, person: true, direction: "A person films themselves wearing or using the product at home, posing in a mirror and reacting naturally." },
  { id: "tv-spot", name: "TV Spot", blurb: "Authentic stories, amplified", group: "commercial", talking: false, person: true, direction: "Broadcast-quality commercial with cinematic camera work, a real-world location, and a mini story arc that ends on the product hero shot." },
  { id: "hyper-motion", name: "Hyper Motion", blurb: "Highlight your product", group: "commercial", talking: false, person: false, direction: "Pure CGI product commercial: dynamic flying camera, premium studio lighting, physics-driven splashes and particles around the product, ending on a clean hero shot." },
  { id: "pro-try-on", name: "Pro Virtual Try On", blurb: "Your product in motion", group: "commercial", talking: false, person: true, direction: "Fashion-film style: the product worn in motion on city streets, cinematic tracking shots and bold scale jumps." },
  { id: "wild-card", name: "Wild Card", blurb: "A unique and creative video mode", group: "commercial", talking: false, person: false, direction: "Surprising, highly creative concept that still makes the product the star. Take a bold creative risk." },
];

export const AD_HOOKS = [
  { id: "product-hit", name: "Product Hit", group: "stunt", text: "An object flies into frame and bumps the person. A brief reaction, then they pivot straight to the product." },
  { id: "interview", name: "Interview", group: "subtle", text: "A street interviewer asks a stranger a quick question; the answer leads straight to the product." },
  { id: "random-object-mic", name: "Random Object Mic", group: "stunt", text: "During a casual vlog, a random absurd object falls into the person's hand from above, and they immediately use it as a microphone to talk about the product." },
  { id: "product-crash", name: "Product Crash", group: "stunt", text: "The product drops from above and lands with a dramatic crash, creating instant chaos before the calm reveal." },
  { id: "blizzard", name: "Blizzard", group: "stunt", text: "A cozy indoor scene is suddenly hit by an impossible blizzard; the person shields the product and keeps talking." },
  { id: "camera-bump", name: "Camera Bump", group: "stunt", text: "The camera operator accidentally bumps into the person, who laughs it off and shows the product up close." },
  { id: "product-dodge", name: "Product Dodge", group: "stunt", text: "The product suddenly flies toward the person's face; they dodge, catch it, and start the review." },
  { id: "whisper", name: "Secret Whisper", group: "subtle", text: "The person leans close to the lens and whispers a secret about the product, as if only the viewer should know." },
  { id: "before-after", name: "Before and After", group: "subtle", text: "A quick split between the frustrating 'before' moment and the satisfying 'after' with the product." },
  { id: "pov", name: "POV Discovery", group: "subtle", text: "Point-of-view shot: the viewer's own hands discover the product for the first time." },
  { id: "stop-scrolling", name: "Stop Scrolling", group: "subtle", text: "The person points at the lens and says 'Stop scrolling, you need to see this' while holding up the product." },
  { id: "question", name: "Honest Question", group: "subtle", text: "The video opens on a relatable question the viewer has asked themselves, answered by the product." },
];

export const AD_SETTINGS = [
  { id: "bedroom", name: "Bedroom", group: "realistic", text: "On a bed propped against pillows, soft window light, a lived-in bedroom." },
  { id: "bathroom", name: "Bathroom", group: "realistic", text: "Mirror selfie or front camera in a bathroom with vanity lighting." },
  { id: "kitchen", name: "Kitchen", group: "realistic", text: "Standing at a kitchen counter in warm daylight." },
  { id: "gym", name: "Gym", group: "realistic", text: "Gym floor or post-workout bench under bright overhead lights." },
  { id: "nature", name: "Nature", group: "realistic", text: "Outdoors on a trail, park, beach, or garden, whichever suits the product." },
  { id: "in-car", name: "In Car", group: "realistic", text: "Selfie from the passenger or driver seat of a parked car, daylight through the windows." },
  { id: "street", name: "Street", group: "realistic", text: "Walking on a busy city sidewalk, handheld phone footage." },
  { id: "office", name: "Office", group: "realistic", text: "Modern office desk with a laptop and natural light." },
  { id: "airplane-wing", name: "Airplane Wing", group: "unrealistic", text: "The person sits casually on an airplane wing mid-flight above the clouds, reviewing the product." },
  { id: "rooftop", name: "Rooftop Edge", group: "unrealistic", text: "Sitting on the edge of a skyscraper rooftop with the city skyline stretched out below." },
  { id: "volcano-rim", name: "Volcano Rim", group: "unrealistic", text: "Sitting calmly on the rim of an active volcano, glowing lava far below." },
  { id: "tiny-reviewer", name: "Tiny Reviewer", group: "unrealistic", text: "The person is shrunk to a few centimetres tall, standing beside a giant version of the product." },
  { id: "car-roof", name: "Car Roof", group: "unrealistic", text: "Riding on the roof of a moving car across the desert." },
  { id: "underwater", name: "Underwater", group: "unrealistic", text: "Underwater in clear tropical water, the product floating beside them." },
];

export const AD_ASPECTS = ["auto", "16:9", "9:16", "4:3", "3:4", "1:1", "21:9"];
export const AD_QUALITIES = ["480p", "720p", "1080p"];

export const findFormat = (id) => AD_FORMATS.find((item) => item.id === id) || AD_FORMATS[0];
export const findHook = (id) => AD_HOOKS.find((item) => item.id === id) || null;
export const findSetting = (id) => AD_SETTINGS.find((item) => item.id === id) || null;

// Built-in presenters: fictional people generated for Marketing Studio.
export const AD_AVATARS = [
  { id: "maya", name: "Maya", gender: "female" },
  { id: "jordan", name: "Jordan", gender: "male" },
  { id: "aiko", name: "Aiko", gender: "female" },
  { id: "liam", name: "Liam", gender: "male" },
  { id: "priya", name: "Priya", gender: "female" },
  { id: "mateo", name: "Mateo", gender: "male" },
  { id: "kenji", name: "Kenji", gender: "male" },
  { id: "sofia", name: "Sofia", gender: "female" },
  { id: "amara", name: "Amara", gender: "female" },
  { id: "noah", name: "Noah", gender: "male" },
  { id: "lena", name: "Lena", gender: "female" },
  { id: "omar", name: "Omar", gender: "male" },
].map((avatar) => ({ ...avatar, builtIn: true, image: `/assets/marketing/avatar-${avatar.id}.webp` }));
export const presetImage = (kind, id) => `/assets/marketing/${kind}-${id}.webp`;
