export function canUploadViaZernio(account = {}) {
  return Boolean(account.zernioApiKey && account.zernioAccountId);
}

export function shouldUploadViaZernio(account = {}) {
  const isTikTok = String(account.platform || "").toLowerCase() === "tiktok";
  if (isTikTok)
    return true;

  if (account.zernioFallbackRequired === true || account.forceZernioUpload === true || account.googleAuthUnavailable === true)
    return canUploadViaZernio(account);

  const hasGoogleOAuth = String(account.accessToken || "").trim() !== ""
    && String(account.accessToken || "") !== "zernio";
  return !hasGoogleOAuth && canUploadViaZernio(account);
}
