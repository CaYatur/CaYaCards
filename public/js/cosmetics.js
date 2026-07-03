// Cosmetic catalogue shared by the customizer UI and the 3D avatar builder.
export const BODY_COLORS = [
  '#e7b24a', '#5b8fd6', '#e08552', '#79b06a',
  '#b069d6', '#52c2c2', '#e06a8b', '#9aa0a8',
  '#d64a4a', '#3fa66b', '#7a5cff', '#ff8c3b',
  '#2bb3a3', '#c0408a', '#4a5568', '#f2d04a',
];

export const HATS = [
  { id: 'none',       emoji: '∅',  label: 'Yok' },
  { id: 'cap',        emoji: '🧢', label: 'Şapka' },
  { id: 'tophat',     emoji: '🎩', label: 'Silindir' },
  { id: 'crown',      emoji: '👑', label: 'Taç' },
  { id: 'beanie',     emoji: '🧶', label: 'Bere' },
  { id: 'party',      emoji: '🥳', label: 'Parti' },
  { id: 'wizard',     emoji: '🧙', label: 'Büyücü' },
  { id: 'halo',       emoji: '😇', label: 'Hale' },
  { id: 'horns',      emoji: '😈', label: 'Boynuz' },
  { id: 'headphones', emoji: '🎧', label: 'Kulaklık' },
  { id: 'cowboy',     emoji: '🤠', label: 'Kovboy' },
  { id: 'flower',     emoji: '🌸', label: 'Çiçek' },
];

export const GLASSES = [
  { id: 'none',    emoji: '∅',  label: 'Yok' },
  { id: 'round',   emoji: '👓', label: 'Yuvarlak' },
  { id: 'shades',  emoji: '🕶️', label: 'Güneş' },
  { id: 'visor',   emoji: '🥽', label: 'Vizör' },
  { id: 'monocle', emoji: '🧐', label: 'Monokl' },
  { id: 'star',    emoji: '⭐', label: 'Yıldız' },
  { id: 'eyepatch',emoji: '🏴‍☠️', label: 'Korsan' },
];

export const FACES = [
  { id: 'happy',     emoji: '🙂' },
  { id: 'cool',      emoji: '😎' },
  { id: 'wink',      emoji: '😉' },
  { id: 'robot',     emoji: '🤖' },
  { id: 'surprised', emoji: '😮' },
  { id: 'grumpy',    emoji: '😠' },
];

// Glowing aura effects rendered around the avatar.
export const AURAS = [
  { id: 'none',    emoji: '∅',  label: 'Yok',     color: null },
  { id: 'ember',   emoji: '🔥', label: 'Ateş',    color: '#ff6a2b' },
  { id: 'frost',   emoji: '❄️', label: 'Buz',     color: '#5ad6ff' },
  { id: 'volt',    emoji: '⚡', label: 'Volt',    color: '#7df0ff' },
  { id: 'gold',    emoji: '🪙', label: 'Altın',   color: '#ffd24a' },
  { id: 'void',    emoji: '🟣', label: 'Boşluk',  color: '#a45cff' },
  { id: 'nature',  emoji: '🍃', label: 'Doğa',    color: '#62d46c' },
  { id: 'rainbow', emoji: '🌈', label: 'Gökkuşağı', color: 'rainbow' },
];

export function defaultCosmetics() {
  return {
    body: BODY_COLORS[Math.floor(Math.random() * BODY_COLORS.length)],
    hat: 'cap',
    glasses: 'round',
    face: 'happy',
    aura: 'none',
  };
}
