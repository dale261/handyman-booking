"use client";

import { saveSettingsAction } from "@/lib/actions";
import { SETTING_FIELDS, type SettingField } from "@/lib/domain/settings";
import type { Settings } from "@/lib/domain/types";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SettingsForm({ settings }: { settings: Settings }) {
  const groups = [...new Set(SETTING_FIELDS.map((field) => field.group))];
  return (
    <form action={saveSettingsAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
          Shop address
          <Input name="shopAddress" defaultValue={settings.shopAddress} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Shop latitude
          <Input name="shopLat" type="number" step="0.000001" defaultValue={settings.shopLat} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Shop longitude
          <Input name="shopLng" type="number" step="0.000001" defaultValue={settings.shopLng} />
        </label>
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
          Email for owner notices
          <Input name="ownerNotifyEmail" type="email" defaultValue={settings.ownerNotifyEmail} placeholder="Your inbox" />
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="rrpCertified" defaultChecked={settings.rrpCertified} />
          RRP certified (lead-safe). The quote form no longer asks the year the home was built; the crew checks the paint on site.
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="premiumEnabled" defaultChecked={settings.premiumEnabled} />
          Area premium on
        </label>
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
          Premium counties, separated by commas
          <Input name="premiumCounties" defaultValue={settings.premiumCounties.join(", ")} />
        </label>
      </div>
      <div className="space-y-3 rounded-md border border-line bg-paper p-4">
        <p className="text-sm font-semibold">On contracts and invoices</p>
        <p className="text-sm text-muted">
          These print at the top of every agreement and invoice. The address is the shop address above. Leave a field blank to leave it off.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">
            Business name
            <Input name="businessName" defaultValue={settings.businessName} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Michigan license number
            <Input name="licenseNumber" defaultValue={settings.licenseNumber} placeholder="Blank until licensed" />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Business phone
            <Input name="businessPhone" type="tel" defaultValue={settings.businessPhone} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Business email
            <Input name="businessEmail" type="email" defaultValue={settings.businessEmail} />
          </label>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
            Workmanship promise, in your words (optional)
            <Textarea name="warrantyText" defaultValue={settings.warrantyText} placeholder="For example: If something we did isn't right, tell us within 30 days and we'll come back and fix it at no charge." className="min-h-20" />
          </label>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
            Other terms for every agreement (optional)
            <Textarea name="extraTerms" defaultValue={settings.extraTerms} placeholder="One paragraph per term. Leave a blank line between terms." className="min-h-20" />
          </label>
        </div>
      </div>
      <p className="text-sm text-muted">
        Amounts marked “example” are starting public ranges. Replace them with your prices. Helper pay, travel, the cancel fee, and the deposit rule are your rules and can be changed here too. The Michigan builder threshold stays at ${settings.builderThreshold} and is not a price.
      </p>
      <Tabs defaultValue={groups[0]}>
        <TabsList>
          {groups.map((group) => (
            <TabsTrigger key={group} value={group}>
              {group}
            </TabsTrigger>
          ))}
        </TabsList>
        {groups.map((group) => (
          <TabsContent key={group} value={group} forceMount className="data-[state=inactive]:hidden">
            <div className="grid gap-3 sm:grid-cols-2">
              {SETTING_FIELDS.filter((field) => field.group === group).map((field) => (
                <RateField key={field.key} field={field} value={Number(settings[field.key])} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <SubmitButton>Save rates and rules</SubmitButton>
    </form>
  );
}

function RateField({ field, value }: { field: SettingField; value: number }) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={field.key}>
        {field.label}
        {field.example ? <span className="ml-2 font-normal text-copper">example</span> : null}
      </Label>
      <Input id={field.key} name={field.key} type="number" step={field.step} defaultValue={value} />
    </div>
  );
}
