
Router.plugin('ensureSignedIn', {
	except: ["ViewApp", "ViewScreen", "ResetPassword"]
});

Router.configure({
	loadingTemplate: 'Loading',
});

AccountsTemplates.configureRoute('signIn', {
	// template: "TSLogin",
	layoutTemplate: "LoginLayout",
	redirect: "/dashboard"
});

// AccountsTemplates.configureRoute('ensureSignedIn', {
//     template: 'myLogin',
//     layoutTemplate: 'myLayout',
// });

Router.route("/", function(){
	this.redirect("/dashboard")
})

Router.route("/logout", function(){
	AccountsTemplates.logout();
});
