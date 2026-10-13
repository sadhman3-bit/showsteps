![](img/logo.png)

# Pay a supplier \<invoice\> & file it

Enter a supplier invoice and send it for approval.

*4 steps · Updated 9 October 2026*

**Before you start**

- You can sign in to Ledgerline
- You have the invoice PDF

## Sign in

**1.** Type **alex** into **Username**

Use your own username.

![Screenshot for step 1: Type alex into Username](img/step-01.png)

**2.** Enter your password

![The sign-in form](img/step-02.png)

> **Tip:** Ask IT if you are locked out.
> They answer within an hour.

## Enter the invoice

**3.** Click **New invoice** (see [*the policy*](https://example.com/policy?a=1&b=2))

> **Warning:** Submitting cannot be undone.

**4.** Click **Submit → done**

![Screenshot for step 4: Click Submit → done](img/step-04.png)

**You’re done when:** The page says “Invoice submitted”.

*Agent-readable procedure embedded (ABCXYZ schema v1).*

<details><summary>Agent procedure</summary>

```json
{
  "format": "trailmark-procedure",
  "schemaVersion": 1,
  "title": "Pay a supplier <invoice> & file it",
  "description": "Enter a supplier invoice and send it for approval.",
  "preconditions": [
    "You can sign in to Ledgerline",
    "You have the invoice PDF"
  ],
  "success": "The page says “Invoice submitted”.",
  "apps": [],
  "variables": [],
  "steps": [
    {
      "number": 1,
      "id": "s1",
      "section": "Sign in",
      "action": "click",
      "instruction": "Type alex into Username",
      "description": "Use your own username.",
      "app": {
        "kind": "web",
        "url": "http://localhost:5173/app/invoices/new"
      },
      "expect": [],
      "onFailure": "The procedure stops here: the target was not found or the expected result did not appear.",
      "confirm": false,
      "visualOnly": false,
      "timeoutMs": 10000
    },
    {
      "number": 2,
      "id": "s2",
      "section": "Sign in",
      "action": "click",
      "instruction": "Enter your password",
      "app": {
        "kind": "web",
        "url": "http://localhost:5173/app/invoices/new"
      },
      "expect": [],
      "onFailure": "The procedure stops here: the target was not found or the expected result did not appear.",
      "confirm": false,
      "visualOnly": false,
      "timeoutMs": 10000
    },
    {
      "number": 3,
      "id": "s3",
      "section": "Enter the invoice",
      "action": "click",
      "instruction": "Click New invoice (see the policy)",
      "notes": [
        "Ask IT if you are locked out.\nThey answer within an hour."
      ],
      "app": {
        "kind": "web",
        "url": "http://localhost:5173/app/invoices/new"
      },
      "expect": [],
      "onFailure": "The procedure stops here: the target was not found or the expected result did not appear.",
      "confirm": false,
      "visualOnly": false,
      "timeoutMs": 10000
    },
    {
      "number": 4,
      "id": "s4",
      "section": "Enter the invoice",
      "action": "click",
      "instruction": "Click Submit → done",
      "notes": [
        "Submitting cannot be undone."
      ],
      "app": {
        "kind": "web",
        "url": "http://localhost:5173/app/invoices/new"
      },
      "expect": [],
      "onFailure": "The procedure stops here: the target was not found or the expected result did not appear.",
      "confirm": false,
      "visualOnly": false,
      "timeoutMs": 10000
    }
  ]
}
```

</details>
