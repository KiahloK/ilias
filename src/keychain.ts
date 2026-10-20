import keytar from "keytar";

const SERVICE = "ilias-sync";

/** Account key combines host and username so several ILIAS instances can coexist. */
function account(baseUrl: string, username: string): string {
  return `${username}@${new URL(baseUrl).host}`;
}

export async function getPassword(baseUrl: string, username: string): Promise<string | undefined> {
  return (await keytar.getPassword(SERVICE, account(baseUrl, username))) ?? undefined;
}

export async function setPassword(baseUrl: string, username: string, password: string): Promise<void> {
  await keytar.setPassword(SERVICE, account(baseUrl, username), password);
}

export async function deletePassword(baseUrl: string, username: string): Promise<void> {
  await keytar.deletePassword(SERVICE, account(baseUrl, username));
}
