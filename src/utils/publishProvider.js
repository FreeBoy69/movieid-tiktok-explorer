export function shouldUploadViaZernio(account = {}) {
  const isTikTok = String(account.platform || "").toLowerCase() === "tiktok";
  if (isTikTok)
    return true;

  const hasGoogleOAuth = String(account.accessToken || "").trim() !== ""
    && String(account.accessToken || "") !== "zernio";
  return !hasGoogleOAuth
    && Boolean(account.zernioApiKey && account.zernioAccountId);
}
