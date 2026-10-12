import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NumberField } from "../components/common/controls";
import { ForwardConfig } from "../components/configuration/ForwardConfig";
import { SystemEditor } from "../components/equations/SystemEditor";
import { FALLBACK_FORWARD_DEFAULTS } from "../project";
import type { SystemSpec } from "../types/api";

const LV: SystemSpec = {
  name: "lv",
  states: [
    { name: "U", initial: 0.5 },
    { name: "R", initial: 0.075 },
  ],
  parameters: [{ name: "alpha", value: 40 }],
  equations: ["alpha*U", "-R"],
};

describe("NumberField", () => {
  it("keeps partial input but only commits valid numbers", () => {
    const onChange = vi.fn();
    render(<NumberField label="lr" value={0.001} onChange={onChange} />);
    const input = screen.getByLabelText("lr");
    fireEvent.change(input, { target: { value: "1e-" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "1e-4" } });
    expect(onChange).toHaveBeenLastCalledWith(1e-4);
  });

  it("enforces integers and minimum", () => {
    const onChange = vi.fn();
    render(<NumberField label="n" integer min={1} value={5} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("n"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("n"), { target: { value: "0" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

function EditorHarness({ validation }: { validation: Parameters<typeof SystemEditor>[0]["validation"] }) {
  const [system, setSystem] = useState(LV);
  return (
    <>
      <SystemEditor system={system} time={{ t0: 0, t1: 1 }} onSystem={setSystem} onTime={() => {}} validation={validation} validating={false} caps={null} disabled={false} />
      <output data-testid="eqs">{system.equations.join("|")}</output>
    </>
  );
}

describe("SystemEditor", () => {
  it("adds and removes a state together with its equation", () => {
    render(<EditorHarness validation={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Add state variable" }));
    expect(screen.getByTestId("eqs").textContent).toBe("alpha*U|-R|0");
    fireEvent.click(screen.getByRole("button", { name: "Remove state U" }));
    expect(screen.getByTestId("eqs").textContent).toBe("-R|0");
  });

  it("shows parser errors next to the offending equation", () => {
    render(<EditorHarness validation={{ ok: false, errors: [{ message: "Undefined symbol 'Q'.", index: 1, field: null }], latex: [], symbols: [], unused_parameters: [] }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Undefined symbol 'Q'.");
    expect(screen.getByLabelText(/dR/i, { selector: "input" })).toHaveAttribute("aria-invalid", "true");
  });
});

describe("ForwardConfig", () => {
  it("warns when Nt_total is not divisible by n_seg and can reset", () => {
    const onChange = vi.fn();
    render(
      <ForwardConfig
        options={{ ...FALLBACK_FORWARD_DEFAULTS, n_seg: 7 }}
        defaults={FALLBACK_FORWARD_DEFAULTS}
        onChange={onChange}
        reference
        onReference={() => {}}
        disabled={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/divisible/);
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(onChange).toHaveBeenCalledWith(FALLBACK_FORWARD_DEFAULTS);
  });
});
