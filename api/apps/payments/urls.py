from django.urls import path

from . import views

urlpatterns = [
    path("wallet", views.WalletView.as_view(), name="wallet"),
    path("wallet/transactions", views.TransactionListView.as_view(), name="wallet-transactions"),
    path("wallet/deposit", views.DepositView.as_view(), name="wallet-deposit"),
    path("wallet/payout", views.PayoutView.as_view(), name="wallet-payout"),
    path("payments/webhooks/<str:operator>", views.webhook_view, name="payment-webhook"),
]
