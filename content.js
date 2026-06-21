(async function main() {
  const response = await chrome.runtime.sendMessage({ type: "GET_PENDING_BALANCE_CHECK" });
  if (!response?.payload) return;

  const card = response.payload;
  const panel = createPanel(card.nickname);
  setPanelStatus(panel, "Looking for the balance form...");

  try {
    await waitFor(() => document.querySelectorAll("input, select").length > 0, 10000);
    const fields = findFields();
    if (!fields.cardNumber || !fields.cvv || !fields.expiry) {
      throw new Error("Could not identify every required field on this page.");
    }

    fillInput(fields.cardNumber, card.number);
    fillExpiry(fields.expiry, card);
    fillInput(fields.cvv, card.cvv);

    setPanelStatus(panel, "Submitting details...");
    const submitted = submitForm(fields.cardNumber);
    if (!submitted) {
      throw new Error("Could not find a submit button.");
    }

    const balance = await waitForBalanceText(20000);
    setPanelStatus(panel, balance ? `Balance found: ${balance}` : "Submitted. Check the page for the balance.");
  } catch (error) {
    setPanelStatus(panel, `${error.message} You can finish manually on this official page.`, true);
  }
})();

function findFields() {
  const inputs = [...document.querySelectorAll("input, select")]
    .filter((input) => !input.disabled && !input.readOnly && isVisible(input));

  const cardNumber = findInput(inputs, ["card number", "card no", "cardnumber", "pan", "number"]);
  const cvv = findInput(inputs, ["cvv", "cvc", "security code", "card security", "verification"]);
  const expiryMonth = findInput(inputs, ["expiry month", "expiration month", "exp month", "month"]);
  const expiryYear = findInput(inputs, ["expiry year", "expiration year", "exp year", "year"]);
  const expiryCombined = findInput(inputs, ["expiry date", "expiration date", "expiry", "expires", "mm/yy", "mm / yy"]);

  let expiry = null;
  if (expiryMonth && expiryYear && expiryMonth !== expiryYear) {
    expiry = { kind: "split", month: expiryMonth, year: expiryYear };
  } else if (expiryCombined) {
    expiry = { kind: "combined", input: expiryCombined };
  } else {
    const remaining = inputs.filter((input) => input !== cardNumber && input !== cvv);
    if (remaining.length >= 2) {
      expiry = { kind: "split", month: remaining[0], year: remaining[1] };
    } else if (remaining.length === 1) {
      expiry = { kind: "combined", input: remaining[0] };
    }
  }

  return { cardNumber, cvv, expiry };
}

function findInput(inputs, terms) {
  const scored = inputs.map((input, index) => {
    const text = fieldText(input);
    let score = 0;
    for (const term of terms) {
      if (text.includes(term)) score += term.length;
    }
    if (input.type === "tel" || input.inputMode === "numeric") score += 1;
    return { input, score, index };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.score > 0 ? scored[0].input : null;
}

function fieldText(input) {
  const parts = [
    input.id,
    input.name,
    input.placeholder,
    input.ariaLabel,
    input.autocomplete,
    input.getAttribute("data-testid"),
    labelText(input),
    input.closest("label")?.textContent,
    input.parentElement?.textContent
  ];
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, 500);
}

function labelText(input) {
  if (!input.id) return "";
  return document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent ?? "";
}

function fillExpiry(expiry, card) {
  if (expiry.kind === "split") {
    fillInput(expiry.month, card.expiryMonth);
    fillInput(expiry.year, card.expiryYear);
    return;
  }
  fillInput(expiry.input, `${card.expiryMonth}/${card.expiryYear}`);
}

function fillInput(input, value) {
  input.focus();
  if (input.tagName === "SELECT") {
    selectOption(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
}

function selectOption(select, value) {
  const normalized = normalizeDigits(value);
  const option = [...select.options].find((candidate) => {
    const candidateValue = normalizeDigits(candidate.value);
    const candidateText = normalizeDigits(candidate.textContent);
    return candidateValue === normalized || candidateText === normalized;
  });
  select.value = option?.value ?? value;
}

function normalizeDigits(value) {
  const digits = String(value).replace(/\D/g, "");
  return digits.length === 1 ? digits.padStart(2, "0") : digits.slice(-2);
}

function submitForm(anchorInput) {
  const form = anchorInput.closest("form");
  const candidates = [
    ...(form ? [...form.querySelectorAll("button, input[type='submit']")] : []),
    ...document.querySelectorAll("button, input[type='submit']")
  ].filter((element) => !element.disabled && isVisible(element));

  const submit = candidates.find((element) => {
    const text = (element.textContent || element.value || "").toLowerCase();
    return /check|balance|submit|continue|next/.test(text);
  }) || candidates[0];

  if (submit) {
    submit.click();
    return true;
  }

  if (form) {
    form.requestSubmit ? form.requestSubmit() : form.submit();
    return true;
  }

  return false;
}

async function waitForBalanceText(timeoutMs) {
  const balancePattern = /(available|remaining|current)?\s*balance[^$]{0,80}(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i;

  return waitFor(() => {
    const text = document.body.innerText.replace(/\s+/g, " ");
    const balanceMatch = text.match(balancePattern);
    if (balanceMatch) return balanceMatch[2];
    return false;
  }, timeoutMs).catch(() => null);
}

function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const result = predicate();
      if (result) {
        resolve(result);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Timed out waiting for the page."));
        return;
      }
      window.setTimeout(tick, 250);
    };
    tick();
  });
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
}

function createPanel(nickname) {
  const panel = document.createElement("div");
  panel.style.cssText = `
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483647;
    max-width: 340px;
    padding: 12px 14px;
    border: 1px solid #dce2ea;
    border-radius: 8px;
    background: #fff;
    color: #1d232b;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    font: 13px/1.4 Arial, Helvetica, sans-serif;
  `;
  panel.innerHTML = `
    <div style="font-weight: 700; margin-bottom: 4px;"></div>
    <div data-status></div>
  `;
  panel.firstElementChild.textContent = `Card Balance: ${nickname}`;
  document.documentElement.appendChild(panel);
  return panel;
}

function setPanelStatus(panel, message, isError = false) {
  const status = panel.querySelector("[data-status]");
  status.textContent = message;
  status.style.color = isError ? "#a73434" : "#657181";
}
