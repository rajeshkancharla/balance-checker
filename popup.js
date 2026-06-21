const BALANCE_URL = "https://www.cardbalance.com.au/";
const KDF_ITERATIONS = 250000;

let vaultKey = null;
let vault = { cards: [] };
let editingCardId = null;
let checkingCardId = null;

const $ = (id) => document.getElementById(id);

const views = {
  setup: $("setupView"),
  unlock: $("unlockView"),
  vault: $("vaultView"),
  cvv: $("cvvView")
};

const enc = new TextEncoder();
const dec = new TextDecoder();

init();

async function init() {
  bindEvents();
  const meta = await storageGet("vaultMeta");
  $("devicePrompt").hidden = !(meta?.vaultMeta?.deviceCredentialId);
  showView(meta?.vaultMeta ? "unlock" : "setup");
}

function bindEvents() {
  $("createVaultButton").addEventListener("click", createVault);
  $("unlockButton").addEventListener("click", unlockVault);
  $("lockButton").addEventListener("click", lockVault);
  $("addCardButton").addEventListener("click", () => openCardForm());
  $("cancelCardButton").addEventListener("click", closeCardForm);
  $("cardForm").addEventListener("submit", saveCard);
  $("deviceVerifyButton").addEventListener("click", setupDeviceVerification);
  $("cancelCvvButton").addEventListener("click", () => showView("vault"));
  $("startCheckButton").addEventListener("click", startBalanceCheck);
}

function showView(name) {
  Object.entries(views).forEach(([key, element]) => {
    element.hidden = key !== name;
  });
  $("lockButton").hidden = !vaultKey;
  setStatus("");
}

function setStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").style.color = isError ? "#a73434" : "#657181";
}

async function createVault() {
  const password = $("setupPassword").value;
  const confirm = $("setupPasswordConfirm").value;
  if (password.length < 10) {
    setStatus("Use at least 10 characters for the vault password.", true);
    return;
  }
  if (password !== confirm) {
    setStatus("Passwords do not match.", true);
    return;
  }

  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  const verifier = await encryptJson(key, { ok: true, createdAt: Date.now() });
  vault = { cards: [] };
  const vaultBlob = await encryptJson(key, vault);

  await chrome.storage.local.set({
    vaultMeta: {
      version: 1,
      salt: bytesToBase64(salt),
      iterations: KDF_ITERATIONS,
      verifier
    },
    vaultBlob
  });

  vaultKey = key;
  $("setupPassword").value = "";
  $("setupPasswordConfirm").value = "";
  renderCards();
  showView("vault");
}

async function unlockVault() {
  const { vaultMeta, vaultBlob } = await storageGet(["vaultMeta", "vaultBlob"]);
  if (!vaultMeta || !vaultBlob) {
    showView("setup");
    return;
  }

  try {
    if (vaultMeta.deviceCredentialId) {
      await requestDeviceVerification(vaultMeta.deviceCredentialId);
    }
    const password = $("unlockPassword").value;
    const key = await deriveKey(password, base64ToBytes(vaultMeta.salt), vaultMeta.iterations);
    await decryptJson(key, vaultMeta.verifier);
    vault = await decryptJson(key, vaultBlob);
    vaultKey = key;
    $("unlockPassword").value = "";
    renderCards();
    showView("vault");
  } catch (error) {
    setStatus("Unlock failed. Check your password and device verification.", true);
  }
}

function lockVault() {
  vaultKey = null;
  vault = { cards: [] };
  checkingCardId = null;
  editingCardId = null;
  showView("unlock");
}

async function saveVault() {
  if (!vaultKey) throw new Error("Vault is locked.");
  const vaultBlob = await encryptJson(vaultKey, vault);
  await chrome.storage.local.set({ vaultBlob });
}

function openCardForm(card = null) {
  editingCardId = card?.id ?? null;
  $("cardFormTitle").textContent = card ? "Edit card" : "Add card";
  $("cardNickname").value = card?.nickname ?? "";
  $("cardNumber").value = formatPan(card?.number ?? "");
  $("expiryMonth").value = card?.expiryMonth ?? "";
  $("expiryYear").value = card?.expiryYear ?? "";
  $("cardForm").hidden = false;
  $("cardNickname").focus();
}

function closeCardForm() {
  editingCardId = null;
  $("cardForm").reset();
  $("cardForm").hidden = true;
}

async function saveCard(event) {
  event.preventDefault();
  const number = digitsOnly($("cardNumber").value);
  const expiryMonth = digitsOnly($("expiryMonth").value).padStart(2, "0");
  const expiryYear = digitsOnly($("expiryYear").value).slice(-2).padStart(2, "0");
  const nickname = $("cardNickname").value.trim() || `Visa ${number.slice(-4)}`;

  if (number.length < 13 || number.length > 19) {
    setStatus("Card number should be 13 to 19 digits.", true);
    return;
  }
  if (!/^(0[1-9]|1[0-2])$/.test(expiryMonth)) {
    setStatus("Expiry month must be 01 to 12.", true);
    return;
  }
  if (!/^\d{2}$/.test(expiryYear)) {
    setStatus("Expiry year must be two digits.", true);
    return;
  }

  const card = {
    id: editingCardId ?? crypto.randomUUID(),
    nickname,
    number,
    expiryMonth,
    expiryYear,
    updatedAt: Date.now()
  };

  if (editingCardId) {
    vault.cards = vault.cards.map((saved) => saved.id === editingCardId ? card : saved);
  } else {
    vault.cards.push(card);
  }

  await saveVault();
  closeCardForm();
  renderCards();
  setStatus("Saved.");
}

function renderCards() {
  const list = $("cardList");
  list.innerHTML = "";
  $("emptyState").hidden = vault.cards.length > 0;

  for (const card of vault.cards) {
    const item = document.createElement("article");
    item.className = "card";
    item.innerHTML = `
      <div class="card-main">
        <div>
          <div class="card-name"></div>
          <div class="card-meta"></div>
        </div>
      </div>
      <div class="card-actions">
        <button type="button" data-action="check">Check</button>
        <button type="button" data-action="edit">Edit</button>
        <button type="button" data-action="delete" class="danger">Delete</button>
      </div>
    `;
    item.querySelector(".card-name").textContent = card.nickname;
    item.querySelector(".card-meta").textContent = `•••• ${card.number.slice(-4)} · ${card.expiryMonth}/${card.expiryYear}`;
    item.querySelector('[data-action="check"]').addEventListener("click", () => openCvvView(card.id));
    item.querySelector('[data-action="edit"]').addEventListener("click", () => openCardForm(card));
    item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteCard(card.id));
    list.appendChild(item);
  }
}

function openCvvView(cardId) {
  checkingCardId = cardId;
  const card = vault.cards.find((item) => item.id === cardId);
  $("cvvTitle").textContent = `Check ${card.nickname}`;
  $("cvvInput").value = "";
  showView("cvv");
  $("cvvInput").focus();
}

async function startBalanceCheck() {
  const cvv = digitsOnly($("cvvInput").value);
  const card = vault.cards.find((item) => item.id === checkingCardId);
  if (!card) {
    setStatus("Card not found.", true);
    return;
  }
  if (cvv.length < 3 || cvv.length > 4) {
    setStatus("Enter the card CVV.", true);
    return;
  }

  await chrome.runtime.sendMessage({
    type: "START_BALANCE_CHECK",
    payload: {
      url: BALANCE_URL,
      card: {
        nickname: card.nickname,
        number: card.number,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        cvv
      }
    }
  });

  $("cvvInput").value = "";
  setStatus("Opening the balance site...");
  window.close();
}

async function deleteCard(cardId) {
  const card = vault.cards.find((item) => item.id === cardId);
  if (!card) return;
  if (!confirm(`Delete ${card.nickname}?`)) return;
  vault.cards = vault.cards.filter((item) => item.id !== cardId);
  await saveVault();
  renderCards();
}

async function setupDeviceVerification() {
  if (!vaultKey) return;
  if (!("credentials" in navigator)) {
    setStatus("This browser does not expose device verification here.", true);
    return;
  }

  try {
    const userId = randomBytes(16);
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: "Local Card Balance Helper" },
        user: {
          id: userId,
          name: "local-vault",
          displayName: "Local vault"
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 }
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required"
        },
        timeout: 60000,
        attestation: "none"
      }
    });

    const { vaultMeta } = await storageGet("vaultMeta");
    vaultMeta.deviceCredentialId = bytesToBase64(new Uint8Array(credential.rawId));
    await chrome.storage.local.set({ vaultMeta });
    setStatus("Device verification enabled.");
  } catch (error) {
    setStatus("Device verification was not enabled.", true);
  }
}

async function requestDeviceVerification(credentialId) {
  await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [
        {
          type: "public-key",
          id: base64ToBytes(credentialId)
        }
      ],
      userVerification: "required",
      timeout: 60000
    }
  });
}

async function deriveKey(password, salt, iterations = KDF_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(key, value) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(value))
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptJson(key, blob) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(blob.iv) },
    key,
    base64ToBytes(blob.ciphertext)
  );
  return JSON.parse(dec.decode(plaintext));
}

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function digitsOnly(value) {
  return String(value).replace(/\D/g, "");
}

function formatPan(value) {
  return digitsOnly(value).replace(/(.{4})/g, "$1 ").trim();
}
