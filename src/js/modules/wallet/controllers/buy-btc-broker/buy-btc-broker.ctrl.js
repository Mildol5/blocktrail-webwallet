(function() {
    "use strict";

    angular.module("blocktrail.core")
        .controller("BuyBTCBrokerCtrl", BuyBTCBrokerCtrl);

    // TODO Needs refactoring
    function BuyBTCBrokerCtrl($scope, $state, dialogService, glideraService,
                              $stateParams, $q, $timeout, $interval, $translate, $filter, trackingService) {

        $scope.broker = $stateParams.broker;
        $scope.brokerNotExistent = false;

        $scope.initializing = true;
        $scope.fetchingMainPrice = true;
        $scope.priceBTC = null;
        $scope.fetchingInputPrice = false;
        $scope.fiatFirst = false;
        $scope.buyInput = {
            currencyType: null,
            fiatCurrency: "USD",
            amount: null,
            btcValue: null,
            fiatValue: null,
            feeValue: null,
            feePercentage: null
        };
        $scope.currencies = [];
        $scope.altCurrency = {};

        var doneTypingInterval = 200;
        var typingTimer = null;

        var lastPriceResponse = null;

        switch ($scope.broker) {
            case "glidera":
                trackingService.trackEvent(trackingService.EVENTS.BUYBTC.GLIDERA_OPEN);
                $scope.buyInput.currencyType = "USD";
                $scope.buyInput.fiatCurrency = "USD";
                break;
            default:
                return null;
                break;
        }

        var fetchBrokerService = function() {
            switch ($scope.broker) {
                case "glidera":
                    return glideraService;
                    break;
                default:
                    return null;
                    break;
            }
        };

        var updateBrokerCurrencies = function() {
            switch ($scope.broker) {
                case "glidera":
                    $scope.currencies = [{code: "USD", symbol: "USD"}];
                    return true;
                    break;
                default:
                    return false;
                    break;
            }
        };

        var updateMainPrice = function() {
            $scope.fetchingMainPrice = true;

            if (fetchBrokerService() == null) {
                $scope.brokerNotExistent = true;
                $scope.initializing = false;
                $scope.fetchingMainPrice = false;
                return null;
            }

            return fetchBrokerService().buyPrices(1, null).then(function(result) {
                $scope.priceBTC = result.total;
                $scope.fetchingMainPrice = false;
            });
        };

        $scope.triggerUpdate = function() {
            clearTimeout(typingTimer);
            typingTimer = setTimeout(function() {
                $scope.updateInputPrice().catch(function() {
                    $scope.fetchingInputPrice = false;
                });
            }, doneTypingInterval);
        };

        $scope.updateInputPrice = function() {
            return $q.when(true).then(function() {
                $scope.fetchingInputPrice = true;

                if ($scope.buyInput.currencyType === "BTC") {
                    $scope.fiatFirst = false;
                    $scope.buyInput.btcValue = parseFloat($scope.buyInput.amount || 0) || 0;
                    $scope.buyInput.fiatValue = null;
                    $scope.buyInput.feeValue = null;
                    $scope.altCurrency = {};

                    if (!$scope.buyInput.amount || !$scope.buyInput.btcValue) {
                        return;
                    }

                    return fetchBrokerService().buyPrices($scope.buyInput.btcValue, null).then(function(result) {
                        $timeout(function() {
                            lastPriceResponse = result;

                            $scope.buyInput.fiatValue = parseFloat(result.total);
                            if (isNaN($scope.buyInput.fiatValue)) {
                                $scope.buyInput.fiatValue = null;
                            }
                            if (result.fees) $scope.buyInput.feeValue = parseFloat(result.fees);
                            if (result.fees) $scope.buyInput.feePercentage = ($scope.buyInput.feeValue / $scope.buyInput.fiatValue) * 100;

                            $scope.altCurrency = {
                                code: $scope.buyInput.fiatCurrency,
                                amount: $scope.buyInput.fiatValue
                            };

                            $scope.fetchingInputPrice = false;
                        });
                    });
                } else {
                    $scope.fiatFirst = true;
                    $scope.buyInput.fiatValue = parseFloat($scope.buyInput.amount || 0) || 0;
                    $scope.buyInput.btcValue = null;
                    $scope.buyInput.feeValue = null;
                    $scope.altCurrency = {};

                    if (!$scope.buyInput.amount || !$scope.buyInput.fiatValue) {
                        return;
                    }

                    return fetchBrokerService().buyPrices(null, $scope.buyInput.fiatValue).then(function(result) {
                        $timeout(function() {
                            lastPriceResponse = result;

                            $scope.buyInput.btcValue = parseFloat(result.qty);
                            if (isNaN($scope.buyInput.btcValue)) {
                                $scope.buyInput.btcValue = null;
                            }
                            if (result.fees) $scope.buyInput.feeValue = parseFloat(result.fees);
                            if (result.fees) $scope.buyInput.feePercentage = ($scope.buyInput.feeValue / $scope.buyInput.fiatValue) * 100;

                            $scope.altCurrency = {
                                code: "BTC",
                                amount: $scope.buyInput.btcValue
                            };

                            $scope.fetchingInputPrice = false;
                        });
                    });
                }// else
            });
        };

        $scope.updateCurrentType = function(currencyType) {
            updateBrokerCurrencies();
            $scope.currencies.unshift({code: "BTC", "symbol": "BTC"});
            $scope.currencies = $scope.currencies.filter(function(currency) {
                return currency.code !== currencyType;
            });

            if (currencyType === "BTC") {
                if ($scope.buyInput.fiatCurrency === $scope.buyInput.currencyType) {
                    $scope.buyInput.amount = $scope.buyInput.btcValue;
                } else {
                    $scope.buyInput.amount = null;
                }
            } else {
                if ($scope.buyInput.fiatCurrency === currencyType) {
                    $scope.buyInput.amount = $scope.buyInput.fiatValue;
                } else {
                    $scope.buyInput.amount = null;
                    $scope.buyInput.fiatCurrency = currencyType;
                }
            }

            $scope.buyInput.currencyType = currencyType;
            $scope.updateInputPrice();
        };

        // set default BTC
        $scope.updateCurrentType("BTC");

        /*
         * init buy getting an access token, repeat until we have an access token
         *  then update main price and set interval for updating price
         */
        var pollInterval;
        var init = function() {
            // update main price for display straight away
            updateMainPrice().then(function() {
                $timeout(function() {
                    $scope.initializing = false;
                });
            });

            // update every minute
            pollInterval = $interval(function() {
                // update main price
                updateMainPrice();
                // update input price
                $scope.updateInputPrice();
            }, 60 * 1000);
        };

        $scope.$on("$destroy", function() {
            if (pollInterval) {
                $interval.cancel(pollInterval);
            }
        });

        $timeout(function() {
            init();
        });

        $scope.buyBTC = function() {
            var spinner;

            var btcValue = $scope.buyInput.btcValue;
            var fiatValue = $scope.buyInput.fiatValue;

            if (fiatValue + btcValue <= 0) {
                return dialogService.prompt({
                    body: $translate.instant("MSG_BUYBTC_ZERO_AMOUNT"),
                    title: $translate.instant("MSG_BUYBTC_CONFIRM_TITLE"),
                    prompt: false
                }).result;
            }

            switch ($scope.broker) {
                case "glidera":

                    return glideraService.buyPricesUuid(btcValue, fiatValue)
                        .then(function(result) {
                            trackingService.trackEvent(trackingService.EVENTS.BUYBTC.GLIDERA_BUY_CONFIRM);
                            return dialogService.prompt({
                                body: $translate.instant("MSG_BUYBTC_CONFIRM_BODY", {
                                    qty: $filter("number")(result.qty, 6),
                                    price: $filter("number")(result.total, 2),
                                    fee: $filter("number")(result.fees, 2),
                                    currencySymbol: $filter("toCurrencySymbol")($scope.buyInput.fiatCurrency)
                                }),
                                title: $translate.instant("MSG_BUYBTC_CONFIRM_TITLE"),
                                prompt: false
                            })
                                .result
                                .then(function() {
                                    spinner = dialogService.spinner({title: "BUYBTC_BUYING"});

                                    return glideraService.buy(result.qty, result.priceUuid)
                                        .then(function() {
                                            spinner.close();

                                            trackingService.trackEvent(trackingService.EVENTS.BUYBTC.GLIDERA_BUY_DONE);

                                            dialogService.alert({
                                                body: $translate.instant("MSG_BUYBTC_BOUGHT_BODY", {
                                                    qty: $filter("number")(result.qty, 6),
                                                    price: $filter("number")(result.total, 2),
                                                    fee: $filter("number")(result.fees, 2),
                                                    currencySymbol: $filter("toCurrencySymbol")("USD")
                                                }),
                                                title: $translate.instant("MSG_BUYBTC_BOUGHT_TITLE")
                                            });

                                            $state.go("app.wallet.summary");
                                        }, function(e) {
                                            trackingService.trackEvent(trackingService.EVENTS.BUYBTC.GLIDERA_BUY_ERR);
                                            throw e;
                                        })
                                        ;
                                });
                        })
                        .then(function() {
                            // -
                        }, function(err) {
                            if (spinner) {
                                spinner.close();
                            }

                            if (err != "CANCELLED" && err != "dismiss") {
                                dialogService.alert({
                                    title: "ERROR_TITLE_1",
                                    body: "" + err
                                });
                            }
                        });
                    break;
            }
        };

        $scope.$watch("broker", function() {
            fetchBrokerService();
        });
    }
})();
