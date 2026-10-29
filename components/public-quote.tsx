"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { publicEstimateAction, startBookingAction } from "@/lib/actions";
import { LOCKED_PRICE } from "@/lib/domain/copy";
import { quoteToolServices } from "@/lib/domain/direct-booking";
import { ADDRESS_MAX, DESCRIPTION_MAX, type QuoteDraft } from "@/lib/domain/draft";
import { DEFAULT_PARAMS, SERVICE_LABELS, type QuoteParams, type ServiceId } from "@/lib/domain/types";
import { usd } from "@/lib/format";
import type { PublicEstimate } from "@/lib/services/estimate";
import { Field, ServiceFields } from "@/components/service-fields";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const SERVICES: ServiceId[] = quoteToolServices();

const PLACEHOLDERS: Record<ServiceId, string> = {
  paint: "For example: repaint the living room walls, one color",
  tv: "For example: mount a 55-inch TV on a drywall wall",
  blinds: "For example: hang blinds on three bedroom windows",
  furniture: "For example: assemble a desk and a bookcase",
  yard: "For example: spring cleanup of the front and back yard",
  clean: "For example: routine clean of the kitchen and two bathrooms",
  helper: "For example: two helpers to move boxes into the garage",
  other: "For example: install 40 feet of baseboard in the hallway",
};

/**
 * The price page for visitors who have no account yet. Same questions and
 * the same rate sheet as the signed-in form. The account comes after the price.
 */
export function PublicQuote({
  helperMax,
  helperMaxHours,
  holdHours,
  initialError,
}: {
  helperMax: number;
  helperMaxHours: number;
  holdHours: number;
  initialError?: string;
}) {
  const [service, setService] = useState<ServiceId>("tv");
  const [params, setParams] = useState<QuoteParams>(DEFAULT_PARAMS);
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [zip, setZip] = useState("");
  const [trap, setTrap] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [pickup, setPickup] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [leadId, setLeadId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<PublicEstimate | null>(null);
  const [error, setError] = useState(initialError ?? "");
  const [pending, start] = useTransition();

  const draft: QuoteDraft = {
    service,
    params,
    address: address.trim(),
    zip: zip.trim(),
    description: description.trim(),
    urgent,
    pickup,
    fullName: fullName.trim(),
    phone: phone.trim(),
    email: email.trim(),
    leadId,
  };

  function patch(partial: Partial<QuoteParams>) {
    setParams((current) => ({ ...current, ...partial }));
    setEstimate(null);
  }

  function chooseService(id: ServiceId) {
    if (id === service) return;
    setService(id);
    setDescription("");
    setEstimate(null);
    setError("");
  }

  return (
    <div className="space-y-4">
      <form
        className="relative grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          start(async () => {
            const result = await publicEstimateAction({ ...draft, website_url_confirm: trap });
            if (result.ok) {
              setLeadId(result.leadId);
              setEstimate(result.estimate);
            } else {
              setError(result.error);
            }
          });
        }}
      >
        <fieldset className="grid gap-3">
          <legend className="font-display text-xl font-semibold">What do you need done?</legend>
          <div className="flex flex-wrap gap-2">
            {SERVICES.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => chooseService(id)}
                className={
                  service === id
                    ? "rounded-full bg-pine px-3 py-1.5 text-sm font-semibold text-white"
                    : "rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold"
                }
              >
                {SERVICE_LABELS[id]}
              </button>
            ))}
          </div>
        </fieldset>

        {service === "other" ? (
          <Card>
            <CardContent className="space-y-3 text-sm">
              <p>
                Other handyman work is priced from your description, so it starts with a free account. You still see one firm price before anything is booked. If the job is unclear or needs a license, we review it first.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/signup">Create an account</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/login?next=%2Fbook">Sign in</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <ServiceFields service={service} params={params} patch={patch} helperMax={helperMax} helperMaxHours={helperMaxHours} />

            <Field label="Describe the job">
              <Textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setEstimate(null);
                }}
                placeholder={PLACEHOLDERS[service]}
                required
                minLength={8}
                maxLength={DESCRIPTION_MAX}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <Field label="Street address where the work is">
                <Input
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setEstimate(null);
                  }}
                  autoComplete="street-address"
                  placeholder="1339 N Mitchell St, Cadillac"
                  required
                  minLength={5}
                  maxLength={ADDRESS_MAX}
                />
              </Field>
              <Field label="ZIP">
                <Input
                  value={zip}
                  onChange={(e) => {
                    setZip(e.target.value.replace(/\D/g, "").slice(0, 5));
                    setEstimate(null);
                  }}
                  autoComplete="postal-code"
                  inputMode="numeric"
                  pattern="\d{5}"
                  placeholder="49601"
                  required
                />
              </Field>
            </div>

            {service !== "helper" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={urgent}
                    onCheckedChange={(value) => {
                      setUrgent(value);
                      setEstimate(null);
                    }}
                    id="public-urgent"
                  />
                  <Label htmlFor="public-urgent">Need it soon</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={pickup}
                    onCheckedChange={(value) => {
                      setPickup(value);
                      setEstimate(null);
                    }}
                    id="public-pickup"
                  />
                  <Label htmlFor="public-pickup">Pick up materials for me</Label>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-line bg-card p-4">
              <p className="text-sm font-semibold">Who&apos;s asking?</p>
              <p className="mt-1 text-sm text-muted">A name and phone number, so we can follow up on this job. Email is optional. No spam, and we never share it.</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Your name">
                  <Input
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      setEstimate(null);
                    }}
                    autoComplete="name"
                    required
                    minLength={2}
                    maxLength={80}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setEstimate(null);
                    }}
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="231-555-0100"
                    required
                    maxLength={30}
                  />
                </Field>
                <Field label="Email (optional)">
                  <Input
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setEstimate(null);
                    }}
                    type="email"
                    autoComplete="email"
                    maxLength={120}
                  />
                </Field>
              </div>
            </div>

            <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
              <label>
                Leave this empty
                <input type="text" name="website_url_confirm" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
              </label>
            </div>

            {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>}
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Adding it up…" : "See my price"}
            </Button>
          </>
        )}
      </form>

      {estimate && service !== "other" && (
        <Card>
          <CardHeader>
            <CardTitle>{estimate.review ? "We'll take a look first" : `Your price: ${usd(estimate.total)}`}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {estimate.review ? (
              <p>{estimate.reviewNote}</p>
            ) : (
              <>
                <p className="text-muted">{estimate.scope}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="py-1 pr-3 font-semibold">Item</th>
                        <th className="py-1 pr-3 font-semibold">Details</th>
                        <th className="py-1 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estimate.lines.map((line, index) => (
                        <tr key={`${line.label}-${index}`} className="border-t border-line">
                          <td className="py-2 pr-3">{line.label}</td>
                          <td className="py-2 pr-3 text-muted">{line.detail}</td>
                          <td className="py-2 text-right font-semibold">{usd(line.amount)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-line">
                        <td className="py-2 font-semibold">Total</td>
                        <td />
                        <td className="py-2 text-right font-semibold">{usd(estimate.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p>
                  Due to book: <strong>{usd(estimate.dueNow)}</strong>{" "}
                  {estimate.balance > 0 ? `(half down). The ${usd(estimate.balance)} balance is due after you approve the finished work.` : "(paid in full)."}
                </p>
                {estimate.payRule && <p className="text-muted">{estimate.payRule}</p>}
                {estimate.assumptions.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-muted">
                    {estimate.assumptions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                <p className="text-muted">{LOCKED_PRICE}</p>
              </>
            )}

            {!estimate.area.auto && (
              <p className="rounded-md border border-copper/30 bg-copper/10 px-3 py-2">
                {estimate.area.known ? estimate.area.detail : "That ZIP is outside our usual area."} We&apos;ll check the address before a time is held. You can still create your account and ask for a time.
              </p>
            )}

            <form action={startBookingAction} className="space-y-2">
              <input type="hidden" name="draft" value={JSON.stringify(draft)} />
              <p>
                {estimate.review
                  ? "Create a free account and we'll get back to you with a price."
                  : `Next: create a free account, pick a time, and pay to book it. The time is held for ${holdHours} hours while you pay.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <SubmitButton name="next" value="signup" size="lg">
                  {estimate.review ? "Create an account" : "Book this price"}
                </SubmitButton>
                <SubmitButton name="next" value="login" variant="outline" size="lg">
                  I already have an account
                </SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
