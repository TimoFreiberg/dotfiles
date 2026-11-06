export function slugify(title) {
  return title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "task";
}
export function template(title, date, owner = "") {
  return `---\nstatus: Open\npriority:\nlabels: []\ngoal:\nowner: ${owner ? JSON.stringify(owner) : ""}\ncreated: ${date}\nticket:\npr:\n---\n\n# ${title.replace(/[\r\n]+/g, " ")}\n\n`;
}
