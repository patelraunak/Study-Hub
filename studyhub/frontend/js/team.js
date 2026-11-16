export const teamMembers = [
  { name: 'Raunak Patel', image: 'team/raunak-patel.jpg', altImage: 'images/team/raunak-patel.jpg' },
  { name: 'Nishant Kumar', image: 'team/nishant-kumar.jpg', altImage: 'images/team/nishant-kumar.jpg' },
  { name: 'Raushan Kumar', image: 'team/raushan-kumar.jpg', altImage: 'images/team/raushan-kumar.jpg' },
  { name: 'Naman Dikshit', image: 'team/naman-dikshit.jpg', altImage: 'images/team/naman-dikshit.jpg' },
];

function getInitials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
}

export function renderTeam(containerElement) {
  if (!containerElement) return;
  containerElement.innerHTML = '';

  teamMembers.forEach((member) => {
    const card = document.createElement('article');
    card.className = 'team-card';

    const avatarSlot = document.createElement('div');
    avatarSlot.className = 'team-photo-wrap';

    const img = document.createElement('img');
    img.className = 'team-photo';
    img.src = member.image;
    img.width = 128;
    img.height = 128;
    img.loading = 'lazy';
    img.alt = `Photo of ${member.name}`;

    img.addEventListener('error', () => {
      if (!img.dataset.retriedRoot) {
        img.dataset.retriedRoot = 'true';
        img.src = `/${String(member.image).replace(/^\/+/, '')}`;
        return;
      }
      if (!img.dataset.retriedTeam && member.altImage) {
        img.dataset.retriedTeam = 'true';
        img.src = member.altImage;
        return;
      }
      const fallback = document.createElement('div');
      fallback.className = 'team-initials-fallback';
      fallback.setAttribute('role', 'img');
      fallback.setAttribute('aria-label', `Photo of ${member.name}`);
      fallback.textContent = getInitials(member.name);
      avatarSlot.replaceChildren(fallback);
    });

    avatarSlot.appendChild(img);

    const nameEl = document.createElement('h3');
    nameEl.className = 'team-name';
    nameEl.textContent = member.name;

    card.appendChild(avatarSlot);
    card.appendChild(nameEl);
    containerElement.appendChild(card);
  });
}
