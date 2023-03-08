import { Wax } from "./Wax";

export class GuardEosio {
  private guard: any = {
    enabled: false,
    endpoint: null,
    stats: {
      error: null,
      errorCode: null,
      message: null,
      cosign: false,
      buyram: false,
    },
  };

  public provider: any;
  public transaction: any;

  private account: any;

  constructor(provider: any, transaction: any) {
    this.provider = provider;
    this.transaction = transaction;

    this.account = this.provider.accountName;
    this.guard.endpoint = this.provider.wax.rpc.endpoint;
  }

  async init(): Promise<any> {
    try {
      if (this.provider.isTemp) {
        const tempAccountRes = await this.createTempAccount();
      }

      const guard = await this.getGuard();

      if (!guard) {
        throw new Error("Unable to handle guard system response");
      }
      //else if (!guard.enabled) {
      //   throw new Error("Guard system is not enabled");
      // }

      this.guard = Object.assign(this.guard, guard);

      const accountInfo = await this.provider.wax.rpc.get_account(this.account);

      if (
        this.guard.cpu_threshold_ms &&
        accountInfo &&
        accountInfo.cpu_limit.available / 1000 >= this.guard.cpu_threshold_ms &&
        this.guard.net_threshold_bytes &&
        accountInfo &&
        accountInfo.net_limit.available >= this.guard.net_threshold_bytes
      ) {
        this.handleAuthorizations();
      } else if (this.guard.stats.cosign) {
        this.modifyActions();
        this.handleAuthorizations();
        this.handleAuthorityProvider();
      } else {
        this.handleAuthorizations();
      }
    } catch (err) {
      //console.log(err);
    }

    return {
      guardProvider: this.provider,
      guardTransaction: this.transaction,
      guardStats: this.guard.stats,
    };
  }

  getGuard(): Promise<any> {
    const endpoint = this.guard.endpoint;
    const account = this.account;
    const data = { account_name: account, actions: this.transaction.actions };

    return fetch(endpoint + "/platform-guard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    })
      .then((response) => response.json())
      .then((data) => {
        // console.log('Success:', data);
        return data;
      })
      .catch((error) => {
        //console.error('Error:', error);
        return;
      });
  }

  modifyActions() {
    if (this.guard.stats.buyram) {
      //insert guard buyrambytes
      this.transaction.actions.unshift({
        account: "eosio",
        name: "buyrambytes",
        authorization: [
          {
            actor: this.guard.contract_account,
            permission: this.guard.contract_permission,
          },
        ],
        data: {
          payer: this.guard.contract_account,
          receiver: this.account,
          bytes: this.guard.buyram_bytes,
        },
      });
    }

    // insert cpu payer's guard action as first action to trigger ONLY_BILL_FIRST_AUTHORIZER
    this.transaction.actions.unshift({
      account: this.guard.contract_account,
      name: this.guard.contract_action,
      authorization: [
        {
          actor: this.guard.contract_account,
          permission: this.guard.contract_permission,
        },
      ],
      data: {
        message: this.guard.uniqid,
      },
    });
  }

  handleAuthorizations() {
    var authorization = [{ actor: this.account, permission: "active" }];

    //check and insert missing authorizations
    this.transaction.actions.forEach(function (action: any) {
      action.authorization = action.authorization
        ? action.authorization
        : authorization;
    });

    console.log(
      "Signing transactions",
      JSON.stringify(this.transaction, null, 4)
    );
  }

  handleAuthorityProvider() {
    const guardAccount = this.guard.contract_account;
    const guardPermission = this.guard.contract_permission;

    // swizzle out authority provider to ignore the fuel permission
    const providerApi = this.provider.wax.api;

    const getRequiredKeys = providerApi.authorityProvider.getRequiredKeys.bind(
      providerApi.authorityProvider
    );
    //console.log(providerApi.authorityProvider.getRequiredKeys);
    providerApi.authorityProvider.getRequiredKeys = async (args: any) => {
      const actions = args.transaction.actions.map((action: any) => {
        const authorization = action.authorization.filter(
          ({ actor, permission }: any) =>
            !(actor === guardAccount && permission === guardPermission)
        );
        return {
          ...action,
          authorization,
        };
      });
      const transaction = {
        ...args.transaction,
        actions,
      };
      return getRequiredKeys({
        ...args,
        transaction,
      });
    };
  }

  createTempAccount() {
    const endpoint = this.guard.endpoint;
    const account = this.account;
    const data = { account_name: account };

    return fetch(endpoint + "/temp-account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    })
      .then((response) => response.json())
      .then((data) => {
        // console.log('Success:', data);
        return data;
      })
      .catch((error) => {
        //console.error('Error:', error);
        return;
      });
  }
}
