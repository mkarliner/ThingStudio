
Router.plugin('ensureSignedIn', {
	except: ["ViewApp", "ViewScreen", "ResetPassword"]
});

Router.configure({
	loadingTemplate: 'Loading',
});

AccountsTemplates.configureRoute('signIn', {
	layoutTemplate: "LoginLayout",
	redirect: "/apps"
});

// AccountsTemplates.configureRoute('ensureSignedIn', {
//     layoutTemplate: 'noErrorWrapper',
// });

Router.route("/", function(){
	this.redirect("/apps")
})

Router.route("/logout", function(){
	AccountsTemplates.logout();
});
