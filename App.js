import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { WebView } from "react-native-webview";

const VAULT_KEY = "balance-checker.vault.v1";
const BALANCE_URL = "https://www.cardbalance.com.au/";
const SECURE_STORE_OPTIONS = Platform.select({
  ios: {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  },
  default: {}
});

const initialForm = {
  id: null,
  nickname: "",
  number: "",
  expiryMonth: "",
  expiryYear: ""
};

export default function App() {
  const [isReady, setReady] = useState(false);
  const [isUnlocked, setUnlocked] = useState(false);
  const [cards, setCards] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [showForm, setShowForm] = useState(false);
  const [checkingCard, setCheckingCard] = useState(null);
  const [cvv, setCvv] = useState("");
  const [webCheck, setWebCheck] = useState(null);
  const [status, setStatus] = useState("");
  const [unlockMessage, setUnlockMessage] = useState("");

  useEffect(() => {
    unlockVault();
  }, []);

  const sortedCards = useMemo(
    () => [...cards].sort((a, b) => a.nickname.localeCompare(b.nickname)),
    [cards]
  );

  async function unlockVault() {
    setStatus("");
    setUnlockMessage("Checking device security...");
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (hasHardware && isEnrolled) {
        const auth = await LocalAuthentication.authenticateAsync({
          promptMessage: "Unlock card vault",
          fallbackLabel: "Use passcode",
          cancelLabel: "Cancel",
          requireConfirmation: false
        });
        if (!auth.success) {
          setReady(true);
          setUnlocked(false);
          setUnlockMessage("Unlock was cancelled.");
          setStatus(auth.error ? `Authentication failed: ${auth.error}` : "");
          return;
        }
      }

      setUnlockMessage("Identity confirmed. Opening vault...");
      const saved = await SecureStore.getItemAsync(VAULT_KEY, SECURE_STORE_OPTIONS);
      const parsed = saved ? JSON.parse(saved) : { cards: [] };
      setCards(Array.isArray(parsed.cards) ? parsed.cards : []);
      setUnlocked(true);
      setReady(true);
      setUnlockMessage("");
    } catch (error) {
      setReady(true);
      setUnlocked(false);
      setUnlockMessage("Could not unlock the local vault.");
      setStatus(`Could not unlock the local vault: ${error.message}`);
    }
  }

  async function saveCards(nextCards) {
    setCards(nextCards);
    await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify({ cards: nextCards }), SECURE_STORE_OPTIONS);
  }

  function openNewCardForm() {
    setForm(initialForm);
    setShowForm(true);
    setStatus("");
  }

  function openEditCardForm(card) {
    setForm({
      id: card.id,
      nickname: card.nickname,
      number: formatPan(card.number),
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear
    });
    setShowForm(true);
    setStatus("");
  }

  async function saveCard() {
    const number = digitsOnly(form.number);
    const expiryMonth = digitsOnly(form.expiryMonth).padStart(2, "0");
    const expiryYear = digitsOnly(form.expiryYear).slice(-2).padStart(2, "0");
    const nickname = form.nickname.trim() || `Visa ${number.slice(-4)}`;

    if (number.length < 13 || number.length > 19) {
      setStatus("Card number should be 13 to 19 digits.");
      return;
    }
    if (!/^(0[1-9]|1[0-2])$/.test(expiryMonth)) {
      setStatus("Expiry month must be 01 to 12.");
      return;
    }
    if (!/^\d{2}$/.test(expiryYear)) {
      setStatus("Expiry year must be two digits.");
      return;
    }

    const card = {
      id: form.id ?? String(Date.now()),
      nickname,
      number,
      expiryMonth,
      expiryYear,
      updatedAt: Date.now()
    };

    const nextCards = form.id
      ? cards.map((saved) => (saved.id === form.id ? card : saved))
      : [...cards, card];

    await saveCards(nextCards);
    setForm(initialForm);
    setShowForm(false);
    setStatus("Saved.");
  }

  function confirmDelete(card) {
    Alert.alert("Delete card", `Delete ${card.nickname}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await saveCards(cards.filter((saved) => saved.id !== card.id));
          setStatus("Deleted.");
        }
      }
    ]);
  }

  function startCvvPrompt(card) {
    setCheckingCard(card);
    setCvv("");
    setStatus("CVV is used once and is not saved.");
  }

  function openBalanceWebView() {
    const cleanCvv = digitsOnly(cvv);
    if (!checkingCard) return;
    if (cleanCvv.length < 3 || cleanCvv.length > 4) {
      setStatus("Enter the card CVV.");
      return;
    }
    setWebCheck({ card: checkingCard, cvv: cleanCvv });
    setCheckingCard(null);
    setCvv("");
    setStatus("");
  }

  function closeWebCheck() {
    setWebCheck(null);
    setStatus("");
  }

  if (!isReady) {
    return screenShell(
      h(Text, { style: styles.loading }, "Preparing local vault..."),
      status
    );
  }

  if (!isUnlocked) {
    return screenShell(
      h(View, { style: styles.centerPanel },
        h(Text, { style: styles.title }, "Balance Checker"),
        h(Text, { style: styles.muted }, unlockMessage || "Vault is locked."),
        h(Button, { label: "Unlock vault", onPress: unlockVault })
      ),
      status
    );
  }

  if (webCheck) {
    return h(SafeAreaView, { style: styles.safe },
      h(StatusBar, { style: "dark" }),
      h(View, { style: styles.webHeader },
        h(View, null,
          h(Text, { style: styles.webTitle }, webCheck.card.nickname),
          h(Text, { style: styles.muted }, "Official balance site")
        ),
        h(Pressable, { style: styles.secondaryButton, onPress: closeWebCheck },
          h(Text, { style: styles.secondaryText }, "Close")
        )
      ),
      h(WebView, {
        source: { uri: BALANCE_URL },
        javaScriptEnabled: true,
        domStorageEnabled: true,
        injectedJavaScript: buildInjectedScript(webCheck.card, webCheck.cvv),
        onMessage: (event) => {
          try {
            const message = JSON.parse(event.nativeEvent.data);
            if (message.type === "status") setStatus(message.text);
            if (message.type === "balance") setStatus(`Balance found: ${message.text}`);
            if (message.type === "error") setStatus(message.text);
          } catch {
            setStatus(event.nativeEvent.data);
          }
        },
        onLoadEnd: () => setStatus("Loaded balance site.")
      }),
      h(Text, { style: styles.status }, status)
    );
  }

  return h(SafeAreaView, { style: styles.safe },
    h(StatusBar, { style: "dark" }),
    h(KeyboardAvoidingView, {
      style: styles.flex,
      behavior: Platform.OS === "ios" ? "padding" : undefined
    },
      h(ScrollView, { contentContainerStyle: styles.container, keyboardShouldPersistTaps: "handled" },
        h(View, { style: styles.header },
          h(View, null,
            h(Text, { style: styles.title }, "Balance Checker"),
            h(Text, { style: styles.muted }, "Local secure card vault")
          ),
          h(Pressable, {
            style: styles.secondaryButton,
            onPress: () => {
              setUnlocked(false);
              setCards([]);
              setUnlockMessage("Vault is locked.");
              setStatus("");
            }
          }, h(Text, { style: styles.secondaryText }, "Lock"))
        ),

        showForm ? renderCardForm() : h(Button, { label: "Add card", onPress: openNewCardForm }),

        checkingCard ? renderCvvPanel() : null,

        h(View, { style: styles.cardList },
          sortedCards.length === 0
            ? h(Text, { style: styles.empty }, "No cards saved yet.")
            : sortedCards.map((card) => h(CardRow, {
                key: card.id,
                card,
                onCheck: () => startCvvPrompt(card),
                onEdit: () => openEditCardForm(card),
                onDelete: () => confirmDelete(card)
              }))
        ),
        h(Text, { style: styles.status }, status)
      )
    )
  );

  function renderCardForm() {
    return h(View, { style: styles.panel },
      h(Text, { style: styles.sectionTitle }, form.id ? "Edit card" : "Add card"),
      h(Field, {
        label: "Nickname",
        value: form.nickname,
        onChangeText: (value) => setForm({ ...form, nickname: value }),
        placeholder: "Officeworks Visa 1234"
      }),
      h(Field, {
        label: "Card number",
        value: form.number,
        onChangeText: (value) => setForm({ ...form, number: formatPan(value) }),
        keyboardType: "number-pad"
      }),
      h(View, { style: styles.row },
        h(Field, {
          label: "Expiry month",
          value: form.expiryMonth,
          onChangeText: (value) => setForm({ ...form, expiryMonth: digitsOnly(value).slice(0, 2) }),
          placeholder: "MM",
          keyboardType: "number-pad",
          containerStyle: styles.rowField
        }),
        h(Field, {
          label: "Expiry year",
          value: form.expiryYear,
          onChangeText: (value) => setForm({ ...form, expiryYear: digitsOnly(value).slice(0, 2) }),
          placeholder: "YY",
          keyboardType: "number-pad",
          containerStyle: styles.rowField
        })
      ),
      h(View, { style: styles.row },
        h(Button, { label: "Save", onPress: saveCard, style: styles.rowField }),
        h(Button, {
          label: "Cancel",
          variant: "secondary",
          onPress: () => {
            setShowForm(false);
            setForm(initialForm);
          },
          style: styles.rowField
        })
      )
    );
  }

  function renderCvvPanel() {
    return h(View, { style: styles.panel },
      h(Text, { style: styles.sectionTitle }, `Check ${checkingCard.nickname}`),
      h(Text, { style: styles.muted }, "CVV is used once and is not saved."),
      h(Field, {
        label: "CVV",
        value: cvv,
        onChangeText: (value) => setCvv(digitsOnly(value).slice(0, 4)),
        keyboardType: "number-pad",
        secureTextEntry: true
      }),
      h(View, { style: styles.row },
        h(Button, { label: "Open and check", onPress: openBalanceWebView, style: styles.rowField }),
        h(Button, {
          label: "Cancel",
          variant: "secondary",
          onPress: () => {
            setCheckingCard(null);
            setCvv("");
          },
          style: styles.rowField
        })
      )
    );
  }
}

function CardRow({ card, onCheck, onEdit, onDelete }) {
  return h(View, { style: styles.card },
    h(View, null,
      h(Text, { style: styles.cardName }, card.nickname),
      h(Text, { style: styles.cardMeta }, `Card ${card.number.slice(-4)} - ${card.expiryMonth}/${card.expiryYear}`)
    ),
    h(View, { style: styles.cardActions },
      h(SmallButton, { label: "Check", onPress: onCheck }),
      h(SmallButton, { label: "Edit", onPress: onEdit }),
      h(SmallButton, { label: "Delete", onPress: onDelete, danger: true })
    )
  );
}

function Field({ label, containerStyle, ...props }) {
  return h(View, { style: [styles.field, containerStyle] },
    h(Text, { style: styles.label }, label),
    h(TextInput, {
      style: styles.input,
      placeholderTextColor: "#8a95a3",
      autoCapitalize: "none",
      autoCorrect: false,
      ...props
    })
  );
}

function Button({ label, onPress, variant = "primary", style }) {
  const isPrimary = variant === "primary";
  return h(Pressable, {
    style: [isPrimary ? styles.primaryButton : styles.secondaryButton, style],
    onPress
  }, h(Text, { style: isPrimary ? styles.primaryText : styles.secondaryText }, label));
}

function SmallButton({ label, onPress, danger = false }) {
  return h(Pressable, { style: styles.smallButton, onPress },
    h(Text, { style: [styles.smallText, danger ? styles.dangerText : null] }, label)
  );
}

function screenShell(content, status) {
  return h(SafeAreaView, { style: styles.safe },
    h(StatusBar, { style: "dark" }),
    h(View, { style: styles.container }, content, h(Text, { style: styles.status }, status))
  );
}

function buildInjectedScript(card, cvv) {
  const payload = JSON.stringify({
    nickname: card.nickname,
    number: card.number,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    cvv
  });

  return `
    (function () {
      const card = ${payload};
      const send = (type, text) => window.ReactNativeWebView.postMessage(JSON.stringify({ type, text }));
      const waitFor = (predicate, timeoutMs) => new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const result = predicate();
          if (result) return resolve(result);
          if (Date.now() - start > timeoutMs) return reject(new Error("Timed out waiting for the page."));
          setTimeout(tick, 250);
        };
        tick();
      });
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const labelText = (input) => {
        const explicit = input.id ? (document.querySelector('label[for="' + CSS.escape(input.id) + '"]')?.textContent || "") : "";
        const wrapped = input.closest("label")?.textContent || "";
        const aria = (input.getAttribute("aria-labelledby") || "")
          .split(/\\s+/)
          .map((id) => document.getElementById(id)?.textContent || "")
          .join(" ");
        return [explicit, wrapped, aria].filter(Boolean).join(" ");
      };
      const fieldText = (input) => [
        input.id,
        input.name,
        input.placeholder,
        input.ariaLabel,
        input.autocomplete,
        input.getAttribute("data-testid"),
        input.getAttribute("aria-label"),
        labelText(input)
      ].filter(Boolean).join(" ").replace(/\\s+/g, " ").toLowerCase().slice(0, 500);
      const isSecurityLike = (input) => /cvv|cvv2|cvc|security|verification|3\\s*-?\\s*digit|enter code/.test(fieldText(input));
      const isExpiryLike = (input) => /expir|expiry|expires|month|year|\\bmm\\b|\\byy\\b|mm\\s*\\/\\s*yy/.test(fieldText(input));
      const sameField = (left, right) => left && right && left === right;
      const cardNumberElements = (field) => {
        if (!field) return [];
        return field.kind === "split" ? field.inputs : [field.input];
      };
      const expiryElements = (field) => {
        if (!field) return [];
        return field.kind === "split" ? [field.month, field.year] : [field.input];
      };
      const isShortField = (input) => {
        const maxLength = Number(input.getAttribute("maxlength") || input.maxLength || 0);
        return maxLength > 0 && maxLength <= 4;
      };
      const scoreInput = (input, terms) => {
        const text = fieldText(input);
        let score = 0;
        for (const term of terms) {
          if (text.includes(term)) score += term.length;
        }
        if (input.type === "tel" || input.inputMode === "numeric") score += 2;
        if (input.autocomplete === "cc-number") score += 40;
        const maxLength = Number(input.getAttribute("maxlength") || input.maxLength || 0);
        if (maxLength >= 12 || maxLength === 0) score += 8;
        if (maxLength > 0 && maxLength <= 4) score -= 8;
        return score;
      };
      const findInput = (inputs, terms, exclude = () => false) => {
        const scored = inputs.filter((input) => !exclude(input)).map((input, index) => {
          const text = fieldText(input);
          let score = scoreInput(input, terms);
          if (terms.includes("card number") && text.includes("card") && text.includes("number")) score += 50;
          return { input, score, index };
        }).sort((a, b) => b.score - a.score || a.index - b.index);
        return scored[0] && scored[0].score > 0 ? scored[0].input : null;
      };
      const findCardNumber = (inputs) => {
        const single = findInput(
          inputs.filter((input) => input.tagName !== "SELECT"),
          ["gift card number", "card number", "card no", "cardnumber", "card num", "pan", "number"],
          (input) => isSecurityLike(input) || isExpiryLike(input)
        );
        if (single) return { kind: "single", input: single };

        const split = inputs
          .filter((input) => input.tagName !== "SELECT" && !isSecurityLike(input) && !isExpiryLike(input))
          .filter((input) => {
            const maxLength = Number(input.getAttribute("maxlength") || input.maxLength || 0);
            return input.type === "tel" || input.inputMode === "numeric" || maxLength === 4;
          })
          .slice(0, 4);
        return split.length >= 4 ? { kind: "split", inputs: split } : null;
      };
      const norm = (value) => {
        const digits = String(value).replace(/\\D/g, "");
        return digits.length === 1 ? digits.padStart(2, "0") : digits.slice(-2);
      };
      const setNativeValue = (input, value) => {
        const prototype = Object.getPrototypeOf(input);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor && descriptor.set) descriptor.set.call(input, value);
        else input.value = value;
      };
      const fill = (input, value) => {
        input.focus();
        if (input.tagName === "SELECT") {
          const normalized = norm(value);
          const raw = String(value);
          const option = Array.from(input.options).find((candidate) => {
            return candidate.value === raw ||
              candidate.textContent.trim() === raw ||
              norm(candidate.value) === normalized ||
              norm(candidate.textContent) === normalized;
          });
          input.value = option ? option.value : value;
        } else {
          setNativeValue(input, value);
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        input.blur();
      };
      const fillCardNumber = (field, number) => {
        const digits = String(number).replace(/\\D/g, "");
        if (field.kind === "split") {
          field.inputs.forEach((input, index) => fill(input, digits.slice(index * 4, index * 4 + 4)));
        } else {
          fill(field.input, digits);
        }
      };
      const findFields = () => {
        const inputs = Array.from(document.querySelectorAll("input, select")).filter((input) => !input.disabled && !input.readOnly && visible(input));
        const cardNumber = findCardNumber(inputs);
        const cardControls = cardNumberElements(cardNumber);
        const isCardControl = (input) => cardControls.some((control) => sameField(control, input));
        const expiryMonth = findInput(inputs, ["expiry month", "expiration month", "exp month", "month", "mm"], (input) => isSecurityLike(input) || isCardControl(input));
        const expiryYear = findInput(inputs, ["expiry year", "expiration year", "exp year", "year", "yy"], (input) => isSecurityLike(input) || isCardControl(input));
        const expiryCombined = findInput(inputs, ["expiry date", "expiration date", "expiry", "expires", "mm/yy", "mm / yy"], (input) => isCardControl(input));
        let expiry = null;
        if (expiryMonth && expiryYear && expiryMonth !== expiryYear) expiry = { kind: "split", month: expiryMonth, year: expiryYear };
        else if (expiryCombined) expiry = { kind: "combined", input: expiryCombined };
        const expiryControls = expiryElements(expiry);
        const isExpiryControl = (input) => expiryControls.some((control) => sameField(control, input));
        const security =
          findInput(inputs, ["cvv2", "cvv", "cvc", "3-digit code", "3 digit code", "enter code", "security code", "card security", "verification"], (input) => isCardControl(input) || isExpiryControl(input)) ||
          inputs.find((input) => input.tagName !== "SELECT" && !isCardControl(input) && !isExpiryControl(input) && (isShortField(input) || /code/.test(fieldText(input)))) ||
          inputs.find((input) => input.tagName !== "SELECT" && !isCardControl(input) && !isExpiryControl(input)) ||
          null;
        const textInputs = inputs.filter((input) => input.tagName !== "SELECT");
        if ((!cardNumber || !security || !expiry) && textInputs.length >= 4) {
          return {
            cardNumber: cardNumber || { kind: "single", input: textInputs[0] },
            security: security || textInputs[textInputs.length - 1],
            expiry: expiry || { kind: "split", month: textInputs[1], year: textInputs[2] }
          };
        }
        return { cardNumber, security, expiry };
      };
      waitFor(() => document.querySelectorAll("input, select").length > 0, 10000)
        .then(async () => {
          send("status", "Filling balance form...");
          const fields = findFields();
          if (!fields.cardNumber || !fields.security || !fields.expiry) throw new Error("Could not identify every required field.");
          fillCardNumber(fields.cardNumber, card.number);
          if (fields.expiry.kind === "split") {
            fill(fields.expiry.month, card.expiryMonth);
            fill(fields.expiry.year, card.expiryYear);
          } else {
            fill(fields.expiry.input, card.expiryMonth + "/" + card.expiryYear);
          }
          fill(fields.security, card.cvv);
          await sleep(300);
          send("status", "Details filled. Tap Submit on the page.");
        })
        .catch((error) => send("error", error.message + " You can finish manually on this official page."));
    })();
    true;
  `;
}

function digitsOnly(value) {
  return String(value).replace(/\D/g, "");
}

function formatPan(value) {
  return digitsOnly(value).replace(/(.{4})/g, "$1 ").trim();
}

const h = React.createElement;

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f6f7f9"
  },
  flex: {
    flex: 1
  },
  container: {
    padding: 16,
    gap: 14
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1d232b"
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d232b",
    marginBottom: 4
  },
  muted: {
    color: "#657181",
    fontSize: 13,
    lineHeight: 18
  },
  loading: {
    color: "#657181",
    fontSize: 16
  },
  centerPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#dce2ea",
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    gap: 12
  },
  panel: {
    backgroundColor: "#ffffff",
    borderColor: "#dce2ea",
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 10
  },
  field: {
    gap: 5
  },
  label: {
    color: "#657181",
    fontSize: 12
  },
  input: {
    minHeight: 44,
    borderColor: "#dce2ea",
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 10,
    color: "#1d232b",
    backgroundColor: "#ffffff",
    fontSize: 16
  },
  row: {
    flexDirection: "row",
    gap: 10
  },
  rowField: {
    flex: 1
  },
  primaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    backgroundColor: "#116d6e",
    paddingHorizontal: 12
  },
  primaryText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15
  },
  secondaryButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    borderColor: "#dce2ea",
    borderWidth: 1,
    backgroundColor: "#eef2f6",
    paddingHorizontal: 12
  },
  secondaryText: {
    color: "#1d232b",
    fontWeight: "700",
    fontSize: 14
  },
  cardList: {
    gap: 10
  },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#dce2ea",
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 12
  },
  cardName: {
    color: "#1d232b",
    fontSize: 16,
    fontWeight: "700"
  },
  cardMeta: {
    color: "#657181",
    marginTop: 2,
    fontSize: 13
  },
  cardActions: {
    flexDirection: "row",
    gap: 8
  },
  smallButton: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    borderColor: "#dce2ea",
    borderWidth: 1,
    backgroundColor: "#eef2f6"
  },
  smallText: {
    color: "#1d232b",
    fontWeight: "700"
  },
  dangerText: {
    color: "#a73434"
  },
  empty: {
    textAlign: "center",
    color: "#657181",
    paddingVertical: 24
  },
  status: {
    minHeight: 22,
    color: "#657181",
    fontSize: 13,
    lineHeight: 18
  },
  webHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    borderBottomColor: "#dce2ea",
    borderBottomWidth: 1,
    backgroundColor: "#ffffff"
  },
  webTitle: {
    color: "#1d232b",
    fontSize: 16,
    fontWeight: "700"
  }
});
