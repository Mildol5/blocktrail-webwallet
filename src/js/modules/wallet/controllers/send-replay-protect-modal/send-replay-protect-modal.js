(function () {
    "use strict";

    angular.module("blocktrail.wallet")
        .controller("SendReplayProtectModal", SendReplayProtectModal);

    function SendReplayProtectModal($scope, $modalInstance, $log, $q, $timeout, $state, $translate,
                                  CurrencyConverter, sendData, FormHelper, $analytics, launchService,
                                  activeWallet, settingsService) {
        $scope.sendData = sendData;
        $scope.walletData = activeWallet.getReadOnlyWalletData();
        $scope.identifier = $scope.walletData.identifier;
        $scope.complete = false;
        $scope.working = false;

        $scope.error = null;
        $scope.detailedError = null;

        $scope.form = {
            password : null,
            two_factor_token: null
        };


        $scope.pay = {};
        $scope.pay[$scope.sendData.recipientAddress] = parseInt(CurrencyConverter.toSatoshi($scope.sendData.amount, "BTC"));
        $scope.feeStrategy = $scope.sendData.feeChoice === 'prioboost' ? blocktrailSDK.Wallet.FEE_STRATEGY_MIN_RELAY_FEE : $scope.sendData.feeChoice;
        $scope.useZeroConf = true;

        $scope.passwordCapsLockOn = false;

        $scope.dismiss = function () {
            $scope.error = null;
            $modalInstance.dismiss();
        };

        $scope.submit = function(sendForm) {
            if ($scope.complete) {
                $modalInstance.dismiss();
                $state.go('app.wallet.summary');
            } else {
                $scope.confirmSend(sendForm);
            }
        };

        activeWallet._sdkWallet.coinSelection($scope.pay, false, $scope.useZeroConf, $scope.feeStrategy)
            .spread(function(utxos, fee, change, feeOptions) {
                $scope.$apply(function() {
                    $scope.fee = fee;
                });
            })
            .catch(function(err) {
                $log.debug(err);
                $scope.fee = false;
            });

        $scope.confirmSend = function (sendForm) {
            if ($scope.working) return;

            FormHelper.setAllDirty(sendForm);

            if (sendForm.$invalid) {
                return false;
            }

            $scope.error = null;
            $scope.detailedError = null;
            $scope.working = true;
            $scope.progressWidth = 5;
            $scope.progressTimeout = $timeout(function() {
                if ($scope.progressWidth >= 90) {
                    $scope.progressWidth = 100;
                    return;
                }
                $scope.progressWidth += 20;
            }, 500);

            $q.when(activeWallet.unlockWithPassword($scope.form.password))
                .then(function(sdkWallet) {
                    $log.info("wallet: unlocked");

                    $log.info("wallet: paying", $scope.pay);

                    var optionMerchantData = null;
                    if ($scope.sendData.paymentDetails) {
                        try {
                            // Converting base64 string to (Uint8)Array
                            optionMerchantData
                                = atob($scope.sendData.paymentDetails.merchantData).split('').map(function (c) { return c.charCodeAt(0); });
                            optionMerchantData = Uint8Array.from(optionMerchantData);
                            $scope.sendData.paymentDetails.outputs[0].script
                                = atob($scope.sendData.paymentDetails.outputs[0].script).split('').map(function (c) { return c.charCodeAt(0); });
                        } catch(e) {
                            throw new Error($translate.instant("MSG_SEND_FAIL_UNKNOWN").sentenceCase());
                        }
                    }

                    var payOptions = {
                        prioboost: $scope.sendData.feeChoice === 'prioboost',
                        bip70PaymentUrl: $scope.sendData.paymentDetails ? $scope.sendData.paymentDetails.paymentUrl : null,
                        bip70MerchantData: $scope.sendData.paymentDetails ? optionMerchantData : null
                    };

                    $analytics.eventTrack('pre-pay', {category: 'Events'});

                    return $q.when(sdkWallet.pay($scope.pay, false, $scope.useZeroConf, true, $scope.feeStrategy, $scope.form.two_factor_token, payOptions)).then(function(txHash) {
                        sdkWallet.lock();
                        return $q.when(txHash);
                    }, function(err) {
                        sdkWallet.lock();
                        return $q.reject(err);
                    });
                })
                .then(function(txHash) {
                    $analytics.eventTrack('pay', {category: 'Events'});

                    // clear sensitive data
                    $scope.form.password = null;

                    settingsService.updateSettingsUp({
                        hideBSVReplayWarning: true
                    }).then(function () {
                        $state.reload();
                    });

                    $log.info("wallet: paid", txHash);
                    $scope.error = null;
                    $scope.detailedError = null;
                    $scope.complete = true;
                    $scope.working = false;
                    $scope.txHash = txHash;
                    $timeout(function() {
                        activeWallet.forcePolling();
                    });
                })
                .catch(function(err) {
                    $scope.error = null;
                    $scope.detailedError = null;
                    $scope.working = false;

                    $timeout.cancel($scope.progressTimeout);

                    if (err instanceof blocktrail.ContactAddressError) {
                        // error getting sending address
                        $scope.error = 'MSG_BAD_CONTACT';
                    } else if (err instanceof blocktrail.WalletPinError || err instanceof blocktrail.WalletChecksumError || err instanceof blocktrail.WalletDecryptError) {
                        FormHelper.setValidityOnce(sendForm.password, 'invalid');
                    } else if (err instanceof blocktrail.WalletMissing2FAError) {
                        // missmatch, 2FA might have been enabled in another tab or smt ...
                        if (!$scope.sendData.requires2FA) {
                            $scope.sendData.requires2FA = true;
                            launchService.updateAccountInfo({requires2FA: true});
                        }

                        FormHelper.setValidityOnce(sendForm.two_factor_token, 'required');

                    } else if (err instanceof blocktrail.WalletInvalid2FAError) {
                        FormHelper.setValidityOnce(sendForm.two_factor_token, 'invalid');

                    } else if (err instanceof blocktrail.WalletFeeError) {
                        $scope.error = 'MSG_LOW_BALANCE_FOR_FEE';
                    } else {
                        $log.error(err);
                        // other error
                        $scope.error = 'MSG_SEND_FAIL_UNKNOWN';
                        $scope.detailedError = ("" + err).replace(/^Error: /, "");
                    }
                })
            ;
        };

    }
})();
