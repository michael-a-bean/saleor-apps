import { Box, Button, Input, Text, Textarea } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

interface DenominationCounts {
  hundreds: number;
  fifties: number;
  twenties: number;
  tens: number;
  fives: number;
  ones: number;
  quarters: number;
  dimes: number;
  nickels: number;
  pennies: number;
}

const defaultDenominations: DenominationCounts = {
  hundreds: 0,
  fifties: 0,
  twenties: 0,
  tens: 0,
  fives: 0,
  ones: 0,
  quarters: 0,
  dimes: 0,
  nickels: 0,
  pennies: 0,
};

const RegisterClosePage: NextPage = () => {
  const router = useRouter();
  const utils = trpcClient.useUtils();

  const { data: currentSession, isLoading: sessionLoading } = trpcClient.register.current.useQuery();
  const { data: cashSummary } = trpcClient.register.cashSummary.useQuery(undefined, {
    enabled: !!currentSession,
  });

  const [closedByName, setClosedByName] = useState("");
  const [notes, setNotes] = useState("");
  const [denominations, setDenominations] = useState<DenominationCounts>(defaultDenominations);

  const closeMutation = trpcClient.register.close.useMutation({
    onSuccess: () => {
      utils.register.current.invalidate();
      router.push("/register");
    },
  });

  const calculateTotal = () => {
    return (
      denominations.hundreds * 100 +
      denominations.fifties * 50 +
      denominations.twenties * 20 +
      denominations.tens * 10 +
      denominations.fives * 5 +
      denominations.ones * 1 +
      denominations.quarters * 0.25 +
      denominations.dimes * 0.1 +
      denominations.nickels * 0.05 +
      denominations.pennies * 0.01
    );
  };

  const updateDenomination = (key: keyof DenominationCounts, value: string) => {
    const numValue = parseInt(value) || 0;

    setDenominations((prev) => ({
      ...prev,
      [key]: Math.max(0, numValue),
    }));
  };

  const handleSubmit = () => {
    if (!closedByName.trim()) {
      alert("Please enter your name");

      return;
    }

    if (!currentSession) {
      return;
    }

    closeMutation.mutate({
      sessionId: currentSession.id,
      notes: notes.trim() ? `Closed by: ${closedByName.trim()}\n${notes.trim()}` : `Closed by: ${closedByName.trim()}`,
      closingCount: denominations,
    });
  };

  if (sessionLoading) {
    return (
      <Box>
        <Text>Loading...</Text>
      </Box>
    );
  }

  if (!currentSession) {
    return (
      <Box display="flex" flexDirection="column" gap={4} alignItems="center" paddingTop={10}>
        <Text size={6}>No register is currently open</Text>
        <Button onClick={() => router.push("/register")}>Go to Register</Button>
      </Box>
    );
  }

  const countedTotal = calculateTotal();
  const expectedCash = cashSummary?.currentCash ?? 0;
  const variance = countedTotal - expectedCash;

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      <Box display="flex" alignItems="center" gap={4}>
        <Button variant="tertiary" onClick={() => router.push("/register")}>
          &larr; Back
        </Button>
        <Text size={8} fontWeight="bold">
          Close Register
        </Text>
      </Box>

      <Box display="flex" flexDirection="column" gap={4} __maxWidth="600px">
        {/* Session Summary */}
        <Box
          padding={4}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
        >
          <Text size={5} fontWeight="bold" marginBottom={4}>
            Session Summary
          </Text>

          <Box display="grid" __gridTemplateColumns="repeat(2, 1fr)" gap={3}>
            <Box>
              <Text size={2} color="default2">
                Register
              </Text>
              <Text size={4}>{currentSession.registerCode}</Text>
            </Box>
            <Box>
              <Text size={2} color="default2">
                Opened By
              </Text>
              <Text size={4}>{currentSession.openedBy ?? "Unknown"}</Text>
            </Box>
            <Box>
              <Text size={2} color="default2">
                Opening Float
              </Text>
              <Text size={4}>${Number(currentSession.openingFloat).toFixed(2)}</Text>
            </Box>
            <Box>
              <Text size={2} color="default2">
                Expected Cash
              </Text>
              <Text size={4} fontWeight="bold">
                ${expectedCash.toFixed(2)}
              </Text>
            </Box>
          </Box>
        </Box>

        {/* Closer Info */}
        <Box
          padding={4}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
        >
          <Text size={5} fontWeight="bold" marginBottom={4}>
            Closer Info
          </Text>

          <Box display="flex" flexDirection="column" gap={3}>
            <Box>
              <Text size={2} marginBottom={1}>
                Your Name *
              </Text>
              <Input
                value={closedByName}
                onChange={(e) => setClosedByName(e.target.value)}
                placeholder="Enter your name"
                size="medium"
              />
            </Box>

            <Box>
              <Text size={2} marginBottom={1}>
                Notes (optional)
              </Text>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about the closing..."
                rows={2}
              />
            </Box>
          </Box>
        </Box>

        {/* Denomination Counting */}
        <Box
          padding={4}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
        >
          <Text size={5} fontWeight="bold" marginBottom={4}>
            Closing Count - Count All Cash
          </Text>

          {/* Bills */}
          <Text size={3} color="default2" marginBottom={2}>
            Bills
          </Text>
          <Box display="grid" __gridTemplateColumns="repeat(3, 1fr)" gap={3} marginBottom={4}>
            <DenominationInput
              label="$100"
              value={denominations.hundreds}
              onChange={(v) => updateDenomination("hundreds", v)}
              multiplier={100}
            />
            <DenominationInput
              label="$50"
              value={denominations.fifties}
              onChange={(v) => updateDenomination("fifties", v)}
              multiplier={50}
            />
            <DenominationInput
              label="$20"
              value={denominations.twenties}
              onChange={(v) => updateDenomination("twenties", v)}
              multiplier={20}
            />
            <DenominationInput
              label="$10"
              value={denominations.tens}
              onChange={(v) => updateDenomination("tens", v)}
              multiplier={10}
            />
            <DenominationInput
              label="$5"
              value={denominations.fives}
              onChange={(v) => updateDenomination("fives", v)}
              multiplier={5}
            />
            <DenominationInput
              label="$1"
              value={denominations.ones}
              onChange={(v) => updateDenomination("ones", v)}
              multiplier={1}
            />
          </Box>

          {/* Coins */}
          <Text size={3} color="default2" marginBottom={2}>
            Coins
          </Text>
          <Box display="grid" __gridTemplateColumns="repeat(4, 1fr)" gap={3}>
            <DenominationInput
              label="Quarters"
              value={denominations.quarters}
              onChange={(v) => updateDenomination("quarters", v)}
              multiplier={0.25}
            />
            <DenominationInput
              label="Dimes"
              value={denominations.dimes}
              onChange={(v) => updateDenomination("dimes", v)}
              multiplier={0.1}
            />
            <DenominationInput
              label="Nickels"
              value={denominations.nickels}
              onChange={(v) => updateDenomination("nickels", v)}
              multiplier={0.05}
            />
            <DenominationInput
              label="Pennies"
              value={denominations.pennies}
              onChange={(v) => updateDenomination("pennies", v)}
              multiplier={0.01}
            />
          </Box>
        </Box>

        {/* Variance Summary */}
        <Box
          padding={4}
          borderRadius={4}
          backgroundColor={Math.abs(variance) > 1 ? "critical1" : "success1"}
        >
          <Box display="grid" __gridTemplateColumns="repeat(3, 1fr)" gap={4}>
            <Box>
              <Text size={2}>Expected</Text>
              <Text size={6} fontWeight="bold">
                ${expectedCash.toFixed(2)}
              </Text>
            </Box>
            <Box>
              <Text size={2}>Counted</Text>
              <Text size={6} fontWeight="bold">
                ${countedTotal.toFixed(2)}
              </Text>
            </Box>
            <Box>
              <Text size={2}>Variance</Text>
              <Text
                size={6}
                fontWeight="bold"
                color={Math.abs(variance) > 1 ? "critical1" : "success1"}
              >
                {variance >= 0 ? "+" : ""}${variance.toFixed(2)}
              </Text>
            </Box>
          </Box>
        </Box>

        {/* Submit */}
        <Box display="flex" justifyContent="flex-end" gap={2}>
          <Button variant="tertiary" onClick={() => router.push("/register")}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="primary"
            size="large"
            disabled={closeMutation.isLoading || !closedByName.trim()}
          >
            {closeMutation.isLoading ? "Closing..." : "Close Register"}
          </Button>
        </Box>

        {closeMutation.error && (
          <Box padding={4} backgroundColor="critical1" borderRadius={4}>
            <Text color="critical1">{closeMutation.error.message}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

interface DenominationInputProps {
  label: string;
  value: number;
  onChange: (value: string) => void;
  multiplier: number;
}

const DenominationInput = ({ label, value, onChange, multiplier }: DenominationInputProps) => {
  const subtotal = value * multiplier;

  return (
    <Box>
      <Text size={2} marginBottom={1}>
        {label}
      </Text>
      <Input
        type="number"
        min="0"
        value={value.toString()}
        onChange={(e) => onChange(e.target.value)}
        size="small"
      />
      <Text size={1} color="default2">
        = ${subtotal.toFixed(2)}
      </Text>
    </Box>
  );
};

export default RegisterClosePage;
