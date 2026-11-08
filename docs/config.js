// Public settings for the website. The publishable key is safe to include here:
// it only allows what the database's security rules allow.
window.EVENTS_HUB = {
  supabaseUrl: 'https://amhnlvjbyqbammedtfvg.supabase.co',
  supabaseKey: 'sb_publishable_I5ItyZLOxGADetUjVk8Omw_klXzRY3k',
  photoHost: 'https://nhyiamu-img.mcadesk.org',
  uploadApi: 'https://nhyiamu-api.mcadesk.org',
  // Paystack PUBLIC key (safe to publish). The secret key is only in Supabase Vault.
  paystackKey: 'pk_live_8b4bda8d0abdd4bc04eb7dcdb40cc0bf0e5e88ba',
  mcaSite: 'https://claude.ai/artifact/SLWAVsm3bgUUfsCn16GKuX',
  defaultTown: 'ejisu-besease',
  // Turn on after Google sign-in is set up in Supabase (Authentication → Providers → Google)
  googleSignIn: false
};
